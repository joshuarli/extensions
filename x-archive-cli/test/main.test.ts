import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";

const mocks = vi.hoisted(() => ({
  downloadProfile: vi.fn(),
  downloadSelf: vi.fn(),
  social: vi.fn(),
  session: vi.fn(),
}));

vi.mock("../src/run.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/run.ts")>(),
  downloadProfile: mocks.downloadProfile,
  downloadSelf: mocks.downloadSelf,
}));
vi.mock("../src/social.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/social.ts")>(),
  downloadSocialLists: mocks.social,
}));
vi.mock("../src/deps.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/deps.ts")>(),
  readBrowserSession: mocks.session,
}));

const summary = (label: string, failures: string[] = []) => ({
  folder: label,
  jsonFile: "posts.json",
  posts: 1,
  mediaTotal: 0,
  mediaDownloaded: 0,
  mediaFailed: 0,
  mediaSkipped: 0,
  archiveHtml: null,
  failures,
  collectionReason: "complete",
  contextPosts: 0,
});

let stdout: ReturnType<typeof vi.spyOn>;
let stderr: ReturnType<typeof vi.spyOn>;

function written(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join("");
}

beforeEach(() => {
  mocks.downloadProfile.mockReset();
  mocks.downloadSelf.mockReset();
  mocks.social.mockReset();
  mocks.session.mockReset().mockResolvedValue({ userId: "42", cookies: [] });
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stdout.mockRestore();
  stderr.mockRestore();
});

const flags = ["--backend=helium", "--cdp-url=http://127.0.0.1:1"];

describe("x archive CLI orchestration", () => {
  it("processes targets serially in order and prints a summary for each", async () => {
    mocks.downloadProfile.mockImplementation(async (handle: string) => summary(handle));

    expect(await main(["download", "alice", "bob", ...flags])).toBe(0);
    const text = written(stderr);
    expect(text.indexOf("[1/2] alice")).toBeLessThan(text.indexOf("[2/2] bob"));
    expect(text).toContain("alice → alice/posts.json · 1 posts");
    expect(text).toContain("bob → bob/posts.json · 1 posts");
    expect(text).toContain("collection: complete");
  });

  it("reports non-fatal failures from every summary and exits 1", async () => {
    mocks.downloadProfile.mockImplementation(async (handle: string) =>
      summary(handle, [handle + " seeding unavailable"]));

    expect(await main(["download", "alice", "bob", ...flags])).toBe(1);
    const text = written(stderr);
    expect(text).toContain("x completed with failures:");
    expect(text).toContain("  alice seeding unavailable");
    expect(text).toContain("  bob seeding unavailable");
  });

  it("stops after a target fails and never starts a later one", async () => {
    mocks.downloadProfile.mockImplementation(async (handle: string) => {
      if (handle === "bob") throw new Error("bad archive");
      return summary(handle);
    });

    expect(await main(["download", "alice", "bob", "carol", ...flags])).toBe(1);
    const text = written(stderr);
    expect(text).toContain("x download failed: bad archive");
    expect(text).toContain("[2/3] bob");
    expect(text).not.toContain("[3/3] carol");
  });

  it("prints the saved list counts for x lists", async () => {
    mocks.social.mockResolvedValue({
      folder: "social-2026-11-25", following: 2, followers: 3,
      reason: "Following:complete, Followers:complete",
    });

    expect(await main(["lists", ...flags])).toBe(0);
    expect(written(stdout)).toBe(
      "social-2026-11-25/following.json 2 users · followers.json 3 users · Following:complete, Followers:complete\n",
    );
  });

  it("reports a failed x lists run without exposing a stack trace", async () => {
    mocks.social.mockRejectedValue(new Error("no signed-in session"));

    expect(await main(["lists", ...flags])).toBe(1);
    expect(written(stderr)).toContain("x lists failed: no signed-in session");
  });
});
