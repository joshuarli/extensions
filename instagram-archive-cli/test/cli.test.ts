import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseArgs, UsageError } from "../src/args.ts";
import type { ArchiveFs } from "../src/fs.ts";
import { assertRunnable, parkJob, readJob } from "../src/job.ts";
import { scanTarget } from "../src/scan.ts";
import { accountDir, collectionDir, readPosts, readState } from "../src/store.ts";
import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import { InstagramRequestFailure } from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";

class MemoryFs implements ArchiveFs {
  readonly files = new Map<string, string>();
  readonly bytes = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();
  mkdir(path: string): void {
    let current = "";
    for (const part of path.split("/")) {
      current = current === "" ? part : current + "/" + part;
      this.dirs.add(current);
    }
  }
  readText(path: string): string | null { return this.files.get(path) ?? null; }
  readBytes(path: string): Uint8Array | null { return this.bytes.get(path) ?? null; }
  writeText(path: string, text: string): void { this.mkdir(join(path, "..")); this.files.set(path, text); }
  writeAtomicText(path: string, text: string): void { this.writeText(path, text); }
  writeAtomicBytes(path: string, data: Uint8Array): void { this.mkdir(join(path, "..")); this.bytes.set(path, data); }
  appendText(path: string, text: string): void { this.files.set(path, (this.files.get(path) ?? "") + text); }
  listDirs(path: string): readonly string[] {
    const prefix = path === "" ? "" : path + "/";
    return [...this.dirs]
      .filter((dir) => dir.startsWith(prefix) && !dir.slice(prefix.length).includes("/"))
      .map((dir) => dir.slice(prefix.length));
  }
  listFiles(path: string): readonly string[] {
    const prefix = path === "" ? "" : path + "/";
    return [...this.files.keys(), ...this.bytes.keys()]
      .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
      .map((file) => file.slice(prefix.length));
  }
  rename(from: string, to: string): void {
    const bytes = this.bytes.get(from);
    if (bytes !== undefined) {
      this.bytes.delete(from);
      this.bytes.set(to, bytes);
      return;
    }
    const text = this.files.get(from);
    if (text !== undefined) {
      this.files.delete(from);
      this.files.set(to, text);
      return;
    }
    throw new Error("Missing source: " + from);
  }
  exists(path: string): boolean { return this.files.has(path) || this.bytes.has(path); }
  remove(path: string): void { this.files.delete(path); this.bytes.delete(path); }
}

function reporter(): ProgressReporter {
  return { update: () => {}, finish: () => {} };
}

function fakeClient(pages: readonly (readonly unknown[])[]): InstagramClient {
  let index = 0;
  return {
    accountId: "acct-1",
    session: { accountId: "acct-1", cookies: {} },
    operations: [],
    openProfile: async () => ({ username: "alice", query: { docId: "1", variables: {} } }),
    profilePage: async () => ({
      posts: pages[index++] ?? [],
      cursor: index < pages.length ? "cursor-" + index : null,
      hasNext: index < pages.length,
    }),
    profileInfo: async () => "1",
    mediaInfo: async () => ({}),
    savedShortcodes: async () => [],
    followingPage: async () => ({ users: [], cursor: null }),
    postPage: async () => [],
    hqTracks: async () => null,
    mediaBytes: async () => new Uint8Array([1]),
    capture: () => () => {},
    close: async () => {},
  } as unknown as InstagramClient;
}

const POST = { code: "abc", image_versions2: { candidates: [{ url: "https://cdn/x.jpg", width: 10, height: 10 }] } };

describe("parseArgs", () => {
  it("parses a scan target and options", () => {
    const parsed = parseArgs(["scan", "@alice", "--out", "/archive", "--limit", "2", "--saved"]);
    expect(parsed.kind).toBe("run");
    if (parsed.kind !== "run") return;
    expect(parsed.options).toMatchObject({
      command: "scan", outRoot: "/archive", limit: 2, saved: true, targets: ["@alice"],
    });
  });

  it("rejects an unknown command and a bad limit", () => {
    expect(() => parseArgs(["nope"])).toThrow(UsageError);
    expect(() => parseArgs(["scan", "@alice", "--limit", "0"])).toThrow(/positive integer/);
  });
});

describe("parked job", () => {
  it("blocks later runs until resume is passed", () => {
    const fs = new MemoryFs();
    parkJob(fs, "/archive", {
      reason: "rate_limit", message: "429", operation: "profile.posts",
      collection: "alice", lastCompleted: "abc", parkedAt: "2026-11-25T00:00:00Z",
    });
    expect(() => assertRunnable(fs, "/archive", false)).toThrow(/--resume/);
    expect(readJob(fs, "/archive")?.collection).toBe("alice");
    expect(() => assertRunnable(fs, "/archive", true)).not.toThrow();
  });
});

describe("scanTarget", () => {
  it("records posts, checkpoints the cursor, and survives a resume", async () => {
    const fs = new MemoryFs();
    const client = fakeClient([[POST], [POST, { code: "def", video_versions: [{ url: "https://cdn/v.mp4", width: 1, height: 1 }] }]]);
    const first = await scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", accountId: "acct-1", limit: null },
      { client, fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal },
      () => {},
    );
    expect(first.written).toBe(2);
    const dir = collectionDir(accountDir("/archive", "acct-1"), "alice");
    expect(readPosts(fs, dir).map((post) => post.shortcode)).toEqual(["abc", "def"]);
    expect(readState(fs, dir, "profile", "alice").complete).toBe(true);

    const second = await scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", accountId: "acct-1", limit: null },
      { client: fakeClient([[POST]]), fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal },
      () => {},
    );
    expect(second.written).toBe(0);
    expect(readPosts(fs, dir)).toHaveLength(2);
  });

  it("parks the job and keeps saved records on a rate limit", async () => {
    const fs = new MemoryFs();
    const client = fakeClient([[POST]]);
    (client as unknown as { profilePage: () => Promise<unknown> }).profilePage = async () => {
      throw new InstagramRequestFailure("rate_limit", "429", "profile.posts");
    };
    const parked: string[] = [];
    await expect(scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", accountId: "acct-1", limit: null },
      { client, fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal },
      (failure, key) => { parked.push(failure.kind + ":" + key); },
    )).rejects.toMatchObject({ kind: "rate_limit" });
    expect(parked).toEqual(["rate_limit:alice"]);
    const dir = collectionDir(accountDir("/archive", "acct-1"), "alice");
    expect(readPosts(fs, dir)).toHaveLength(0);
  });
});
