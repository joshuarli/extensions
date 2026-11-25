import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphqlRequest, RequestFailure } from "../../x-archive-core/src/api.ts";
import { captureRequest, mergeCapture, mergeCredentials, type Credentials } from "../../x-archive-core/src/capture.ts";
import { credentialCapturePlan } from "../../x-archive-cli/src/deps.ts";
import { connectX } from "../src/client.ts";

const session = { userId: "172", cookies: [{ name: "ct0", value: "csrf" }] };
const sessionProvider = async () => ({ userId: "172", csrfToken: "csrf", cookieHeader: "ct0=csrf" });

function capturedHome(): Credentials {
  const headers = [
    { name: "authorization", value: "Bearer webapp" },
    { name: "x-client-transaction-id", value: "tx" },
  ];
  const body = JSON.stringify({ variables: { count: 20 }, features: { a: true } });
  const capture = captureRequest(
    "https://x.com/i/api/graphql/abc123/HomeTimeline",
    "https://x.com",
    headers,
    "POST",
    body,
  );
  if (!capture) throw new Error("captureRequest did not recognize the Home request");
  return mergeCapture({ queryIds: {}, features: {} }, capture);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("credential acquisition", () => {
  it("keeps the POST method through capture, cache merge and request execution", async () => {
    const captured = capturedHome();
    const disk: Credentials = {
      ...captured,
      methods: undefined,
      queryIds: { HomeTimeline: "abc123", UserByScreenName: "lookup" },
    };
    const merged = mergeCredentials(disk, captured);
    expect(merged.methods?.["HomeTimeline"]).toBe("POST");

    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    await Effect.runPromise(graphqlRequest(
      "172", merged, "HomeTimeline", { count: 20 }, new AbortController().signal, sessionProvider,
    ));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.body))).toMatchObject({ variables: { count: 20 }, features: { a: true } });
  });

  it("opens the Home page on a cold start and honors required capabilities", () => {
    const plan = credentialCapturePlan([["HomeTimeline"]], undefined, null, null);
    expect(plan.needsCapture).toBe(true);
    expect(plan.pages).toEqual(["https://x.com/home"]);

    const lookup = credentialCapturePlan([["UserByScreenName"]], "arthouse_dave", null, null);
    expect(lookup.pages).toEqual(["https://x.com/arthouse_dave"]);
    expect(() => credentialCapturePlan([["UserByScreenName"]], undefined, null, null)).toThrow("valid @handle");
  });

  it("does not need capture when the disk cache already satisfies the request", () => {
    const cached: Credentials = { ...capturedHome(), authorization: "Bearer webapp" };
    const plan = credentialCapturePlan([["HomeTimeline"]], undefined, cached, null);
    expect(plan.needsCapture).toBe(false);
  });
});

describe("connectX", () => {
  it("recovers from a rejected Home configuration with exactly one reobservation and retry", async () => {
    const captured = capturedHome();
    let readOptions: { required?: unknown; screenName?: string | undefined } | undefined;
    let refreshCount = 0;
    let requestCount = 0;
    const persisted: Credentials[] = [];
    const client = await connectX({
      required: [["HomeTimeline"]],
      dependencies: {
        readSession: async () => session,
        readCredentials: async (_session, _cdpUrl, _backend, options) => {
          readOptions = options;
          return { queryIds: {}, features: {} };
        },
        captureHome: async () => {
          refreshCount++;
          return refreshCount === 1 ? captured : {
            ...captured,
            queryIds: { ...captured.queryIds, HomeTimeline: "newquery" },
          };
        },
        persist: (credentials) => { persisted.push(credentials); },
        request: async () => {
          requestCount++;
          if (requestCount === 1) throw new RequestFailure("query", "obsolete query id");
          return { data: { ok: true } };
        },
      },
    });
    expect(readOptions?.required).toEqual([["HomeTimeline"]]);
    expect(refreshCount).toBe(1);
    expect(client.operations).toContain("HomeTimeline");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.methods?.["HomeTimeline"]).toBe("POST");

    await expect(client.request("HomeTimeline", {}, new AbortController().signal)).resolves.toEqual({ data: { ok: true } });
    expect(requestCount).toBe(2);
    expect(refreshCount).toBe(2);
  });

  it("does not retry a rejected configuration when reobservation returns the same one", async () => {
    const captured = capturedHome();
    let requestCount = 0;
    const client = await connectX({
      required: [["HomeTimeline"]],
      dependencies: {
        readSession: async () => session,
        readCredentials: async () => captured,
        captureHome: async () => captured,
        persist: () => {},
        request: async () => {
          requestCount++;
          throw new RequestFailure("query", "still obsolete");
        },
      },
    });
    await expect(client.request("HomeTimeline", {}, new AbortController().signal)).rejects.toThrow("manual refresh");
    expect(requestCount).toBe(1);
  });
});
