import { describe, expect, it } from "vitest";
import { knownAccountIds } from "../src/state.ts";
import { createMemoryFs } from "./fakes.ts";

function fsWith(folders: Record<string, string | null>) {
  const fs = createMemoryFs();
  for (const [folder, manifest] of Object.entries(folders)) {
    fs.dirs.add("/downloads/" + folder);
    if (manifest !== null) fs.files.set("/downloads/" + folder + "/manifest.json", manifest);
  }
  return fs;
}

describe("knownAccountIds", () => {
  it("returns the one saved account so the client can guard it", () => {
    const fs = fsWith({
      "chatgpt-acct-1": JSON.stringify({ accountId: "acct-1" }),
      "chatgpt-2026-11-22": null,
      "unrelated": null,
    });
    expect(knownAccountIds(fs, "/downloads")).toEqual(["acct-1"]);
  });

  it("returns every saved account so the caller can skip the guard", () => {
    const fs = fsWith({
      "chatgpt-acct-1": JSON.stringify({ accountId: "acct-1" }),
      "chatgpt-acct-2": JSON.stringify({ accountId: "acct-2" }),
    });
    expect(knownAccountIds(fs, "/downloads").sort()).toEqual(["acct-1", "acct-2"]);
  });

  it("fails loudly on an unreadable manifest", () => {
    const fs = fsWith({ "chatgpt-acct-1": "not json" });
    expect(() => knownAccountIds(fs, "/downloads"))
      .toThrow("The archive manifest at /downloads/chatgpt-acct-1/manifest.json is unreadable.");
  });
});
