import type { ObservedRequest } from "./browser.ts";
import { InstagramRequestFailure } from "./failures.ts";
import { PROFILE_QUERY_NAME } from "./operations.ts";
import { classifyPage } from "./session.ts";

export interface ProfilePostsQuery {
  readonly docId: string;
  readonly variables: Record<string, unknown>;
}

export interface ProfileSession {
  readonly username: string;
  readonly query: ProfilePostsQuery;
}

function stopped(signal: AbortSignal): void {
  if (signal.aborted) throw new InstagramRequestFailure("stopped", "Stopped by user.", "profile.posts");
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  stopped(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(new InstagramRequestFailure("stopped", "Stopped by user.", "profile.posts")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseQuery(body: string): ProfilePostsQuery {
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(body);
  } catch {
    throw new InstagramRequestFailure("unrecognized", "Profile query body was not form encoded.", "profile.posts");
  }
  const docId = form.get("doc_id");
  const raw = form.get("variables");
  if (docId === null || docId === "" || raw === null || raw === "") {
    throw new InstagramRequestFailure("unrecognized", "Profile query was missing doc_id or variables.", "profile.posts");
  }
  let variables: unknown;
  try {
    variables = JSON.parse(raw);
  } catch {
    throw new InstagramRequestFailure("unrecognized", "Profile query variables were not JSON.", "profile.posts");
  }
  if (variables === null || typeof variables !== "object" || Array.isArray(variables)) {
    throw new InstagramRequestFailure("unrecognized", "Profile query variables were not an object.", "profile.posts");
  }
  const copy = { ...(variables as Record<string, unknown>) };
  delete copy["after"];
  delete copy["before"];
  return { docId, variables: copy };
}

export interface CaptureDependencies {
  navigate(url: string): Promise<void>;
  pageText(): Promise<string>;
  onRequest(listener: (request: ObservedRequest) => void): () => void;
}

export async function captureProfileQuery(
  deps: CaptureDependencies,
  username: string,
  signal: AbortSignal,
): Promise<ProfileSession> {
  const deadline = Date.now() + 20_000;
  let body: string | undefined;
  const stop = deps.onRequest((request) => {
    if (request.method.toUpperCase() !== "POST") return;
    if (request.postData !== undefined && request.postData.includes(PROFILE_QUERY_NAME)) body = request.postData;
  });
  try {
    stopped(signal);
    await deps.navigate("https://www.instagram.com/" + encodeURIComponent(username) + "/");
    while (body === undefined && Date.now() < deadline) {
      stopped(signal);
      const text = await deps.pageText().catch(() => "");
      classifyPage("https://www.instagram.com/" + username + "/", text, "profile.posts");
      await wait(250, signal);
    }
    if (body === undefined) {
      const text = await deps.pageText().catch(() => "");
      classifyPage("https://www.instagram.com/" + username + "/", text, "profile.posts");
      throw new InstagramRequestFailure("unrecognized", "The profile page did not issue " + PROFILE_QUERY_NAME + ".", "profile.posts");
    }
    return { username, query: parseQuery(body) };
  } finally {
    stop();
  }
}

export function queryBody(session: ProfileSession, cursor: string | null): string {
  const variables: Record<string, unknown> = { ...session.query.variables, username: session.username };
  delete variables["after"];
  delete variables["before"];
  if (cursor !== null) variables["after"] = cursor;
  const form = new URLSearchParams({
    doc_id: session.query.docId,
    variables: JSON.stringify(variables),
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: PROFILE_QUERY_NAME,
    server_timestamps: "true",
  });
  return form.toString();
}
