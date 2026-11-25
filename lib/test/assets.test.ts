import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeExtension } from "../assets.ts";
import { makeTempDir } from "./tmp.ts";

let directory: string | undefined;

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("materializeExtension", () => {
  it("removes files that are no longer part of the embedded bundle", () => {
    directory = makeTempDir("x-extension-assets-");
    const root = join(directory, "extension-suite");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "stale.js"), "old build");
    const materialized = materializeExtension({ XDG_CACHE_HOME: directory });
    expect(existsSync(join(materialized, "stale.js"))).toBe(false);
    expect(existsSync(join(materialized, "manifest.json"))).toBe(true);
  });
});
