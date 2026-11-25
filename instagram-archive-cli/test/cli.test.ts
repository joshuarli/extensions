import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parseArgs, UsageError } from "../src/args.ts";
import type { ArchiveFs } from "../src/fs.ts";
import { getTarget } from "../src/get.ts";
import { assertRunnable, parkJob, readJob } from "../src/job.ts";
import { scanTarget } from "../src/scan.ts";
import { appendPosts, collectionDir, listCollections, markMembership, readPosts, readState, recordsPath, writeState } from "../src/store.ts";
import { emptyCollection } from "../../instagram-archive-core/src/index.ts";
import type { InstagramClient } from "../../instagram-client-core/src/index.ts";
import { InstagramRequestFailure, MediaTooLarge } from "../../instagram-client-core/src/index.ts";
import type { ProgressReporter } from "../../lib/progress.ts";

class MemoryFs implements ArchiveFs {
  readonly files = new Map<string, string>();
  readonly bytes = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>();
  mkdir(path: string): void {
    let current = path.startsWith("/") ? "/" : "";
    for (const part of path.split("/")) {
      if (part === "") continue;
      current = current === "" || current === "/" ? current + part : current + "/" + part;
      this.dirs.add(current);
    }
  }
  readText(path: string): string | null { return this.files.get(path) ?? null; }
  readBytes(path: string): Uint8Array | null { return this.bytes.get(path) ?? null; }
  size(path: string): number | null {
    const bytes = this.bytes.get(path);
    if (bytes !== undefined) return bytes.byteLength;
    const text = this.files.get(path);
    return text === undefined ? null : text.length;
  }
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

  it("pauses 1500 ms by default, accepts 0, and rejects the retired --jobs", () => {
    const parsed = parseArgs(["get", "@alice"]);
    expect(parsed.kind === "run" && parsed.options.pauseMs).toBe(1500);
    const off = parseArgs(["get", "@alice", "--pause-ms", "0"]);
    expect(off.kind === "run" && off.options.pauseMs).toBe(0);
    expect(() => parseArgs(["get", "@alice", "--pause-ms", "-1"])).toThrow(UsageError);
    expect(() => parseArgs(["get", "@alice", "--jobs", "2"])).toThrow(/Unknown option/);
  });

  it("rejects an unknown command and a bad limit", () => {
    expect(() => parseArgs(["nope"])).toThrow(UsageError);
    expect(() => parseArgs(["scan", "@alice", "--limit", "0"])).toThrow(/positive integer/);
  });

  it("caps media at 512 MB by default and accepts size suffixes", () => {
    const parsed = parseArgs(["get", "@alice"]);
    expect(parsed.kind === "run" && parsed.options.maxMediaBytes).toBe(512 * 1024 * 1024);
    const sized = parseArgs(["get", "@alice", "--max-media-size", "1M"]);
    expect(sized.kind === "run" && sized.options.maxMediaBytes).toBe(1024 * 1024);
    const unlimited = parseArgs(["get", "@alice", "--max-media-size", "0"]);
    expect(unlimited.kind === "run" && unlimited.options.maxMediaBytes).toBe(0);
    expect(() => parseArgs(["get", "@alice", "--max-media-size", "big"])).toThrow(UsageError);
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

describe("readPosts", () => {
  it("rejects a post missing a caption at its line number", () => {
    const fs = new MemoryFs(),
      dir = "/archive/alice",
      valid = { shortcode: "abc", username: "alice", postType: "image", caption: null, media: [{ url: "https://cdn/a.jpg", kind: "image", width: 1, height: 1 }] },
      malformed = { shortcode: "def", username: "alice", postType: "image", media: [] };
    fs.writeText(recordsPath(dir), JSON.stringify(valid) + "\n" + JSON.stringify(malformed) + "\n");
    expect(() => readPosts(fs, dir)).toThrow(/line 2/);
  });
});

describe("listCollections", () => {
  it("finds flattened collections by their state file and ignores other root entries", () => {
    const fs = new MemoryFs();
    const dir = collectionDir("/archive", "alice");
    fs.mkdir(dir);
    writeState(fs, dir, emptyCollection("profile", "alice"));
    fs.mkdir(join("/archive", "@incomplete"));
    fs.writeText(join("/archive", "index.html"), "");
    expect(listCollections(fs, "/archive")).toEqual(["alice"]);
  });
});

describe("scanTarget", () => {
  it("records posts, checkpoints the cursor, and survives a resume", async () => {
    const fs = new MemoryFs();
    const client = fakeClient([[POST], [POST, { code: "def", video_versions: [{ url: "https://cdn/v.mp4", width: 1, height: 1 }] }]]);
    const first = await scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", limit: null },
      { client, fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal, pause: async () => {} },
      () => {},
    );
    expect(first.written).toBe(2);
    const dir = collectionDir("/archive", "alice");
    expect(readPosts(fs, dir).map((post) => post.shortcode)).toEqual(["abc", "def"]);
    expect(readState(fs, dir, "profile", "alice").complete).toBe(true);

    const second = await scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", limit: null },
      { client: fakeClient([[POST]]), fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal, pause: async () => {} },
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
      { target: "@alice", saved: false, outRoot: "/archive", limit: null },
      { client, fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal, pause: async () => {} },
      (failure, key) => { parked.push(failure.kind + ":" + key); },
    )).rejects.toMatchObject({ kind: "rate_limit" });
    expect(parked).toEqual(["rate_limit:alice"]);
    const dir = collectionDir("/archive", "alice");
    expect(readPosts(fs, dir)).toHaveLength(0);
  });
});

describe("pacing", () => {
  it("pauses between scan pages, not before the first", async () => {
    const fs = new MemoryFs();
    const events: string[] = [];
    const client = fakeClient([[POST], [{ code: "def", image_versions2: POST.image_versions2 }]]);
    const profilePage = client.profilePage.bind(client);
    (client as unknown as { profilePage: typeof profilePage }).profilePage = async (...args) => {
      events.push("page");
      return profilePage(...args);
    };
    await scanTarget(
      { target: "@alice", saved: false, outRoot: "/archive", limit: null },
      { client, fs, reporter: reporter(), now: () => 0, signal: new AbortController().signal, pause: async () => { events.push("pause"); } },
      () => {},
    );
    expect(events).toEqual(["page", "pause", "page"]);
  });

  it("pauses between posts during get, not before the first", async () => {
    const fs = new MemoryFs();
    const dir = collectionDir("/archive", "alice");
    const image = (shortcode: string) => ({ shortcode, username: "alice", postType: "image" as const, caption: null, media: [{ url: "https://cdn/" + shortcode + ".jpg", kind: "image" as const, width: 1, height: 1 }] });
    fs.mkdir(dir);
    appendPosts(fs, dir, [image("abc"), image("def")]);
    const events: string[] = [];
    const client = fakeClient([]);
    (client as unknown as { mediaBytes: (url: string) => Promise<Uint8Array> }).mediaBytes = async (url) => {
      events.push("fetch " + url);
      return new Uint8Array([1]);
    };
    const summary = await getTarget(
      { outRoot: "/archive", key: "alice", kind: "profile", mediaDir: "images", limit: null, maxMediaBytes: 0 },
      { client, fs, reporter: reporter(), signal: new AbortController().signal, pause: async () => { events.push("pause"); } },
      () => {},
    );
    expect(summary.downloaded).toBe(2);
    expect(events).toEqual(["fetch https://cdn/abc.jpg", "pause", "fetch https://cdn/def.jpg"]);
  });
});

describe("resolved media", () => {
  it("persists media found on the post page and marks the post complete", async () => {
    const fs = new MemoryFs();
    const dir = collectionDir("/archive", "alice");
    const post = { shortcode: "abc", username: "alice", postType: "image" as const, caption: null, media: [] };
    fs.mkdir(dir);
    appendPosts(fs, dir, [post]);
    writeState(fs, dir, markMembership(emptyCollection("profile", "alice"), [post], "2026-11-25T00:00:00Z"));
    const client = fakeClient([]);
    (client as unknown as { postPage: (shortcode: string) => Promise<unknown> }).postPage = async () => [
      { url: "https://cdn/abc.jpg", kind: "image", width: 10, height: 10 },
    ];
    const summary = await getTarget(
      { outRoot: "/archive", key: "alice", kind: "profile", mediaDir: "images", limit: null, maxMediaBytes: 0 },
      { client, fs, reporter: reporter(), signal: new AbortController().signal, pause: async () => {} },
      () => {},
    );
    expect(summary).toMatchObject({ downloaded: 1, skipped: 0, failed: 0, remaining: 0 });
    expect(readPosts(fs, dir)[0]?.media).toEqual([{ url: "https://cdn/abc.jpg", kind: "image", width: 10, height: 10 }]);
    expect(readState(fs, dir, "profile", "alice").membership["abc"]?.complete).toBe(true);
  });
});

describe("media size limit", () => {
  it("counts oversized media as skipped without writing it", async () => {
    const fs = new MemoryFs();
    const dir = collectionDir("/archive", "alice");
    fs.mkdir(dir);
    appendPosts(fs, dir, [{
      shortcode: "abc", username: "alice", postType: "image", caption: null,
      media: [{ url: "https://cdn/abc.jpg", kind: "image", width: 1, height: 1 }],
    }]);
    const client = fakeClient([]);
    (client as unknown as { mediaBytes: (url: string) => Promise<Uint8Array> }).mediaBytes = async () => {
      throw new MediaTooLarge(2048);
    };
    const summary = await getTarget(
      { outRoot: "/archive", key: "alice", kind: "profile", mediaDir: "images", limit: null, maxMediaBytes: 1024 },
      { client, fs, reporter: reporter(), signal: new AbortController().signal, pause: async () => {} },
      () => {},
    );
    expect(summary).toMatchObject({ downloaded: 0, skipped: 1, failed: 0, remaining: 1 });
    expect(fs.exists(join(dir, "images", "abc.jpg"))).toBe(false);
  });
});
