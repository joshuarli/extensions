import { afterEach, expect, it } from "vitest";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { credentialsCachePath, downloadsRoot, readRawFile, stateDir, stateRoot, storeDir } from "../src/state.ts";

const keys = ["X_ARCHIVE_STATE", "XDG_STATE_HOME", "X_ARCHIVE_DOWNLOADS", "XDG_DATA_HOME"] as const;
const original = keys.map((key) => process.env[key]);
afterEach(() => keys.forEach((key, i) => { const value = original[i]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }));

it("resolves explicit and default state and download locations", () => {
  for (const key of keys) delete process.env[key];
  expect(stateRoot()).toBe(join(homedir(), ".local", "state", "x-archive"));
  expect(downloadsRoot()).toBe(join(homedir(), ".local", "share", "x", "downloads"));
  process.env["XDG_STATE_HOME"] = "/state-xdg";
  process.env["XDG_DATA_HOME"] = "/data-xdg";
  expect(stateRoot()).toBe("/state-xdg/x-archive");
  expect(downloadsRoot()).toBe("/data-xdg/x/downloads");
  process.env["X_ARCHIVE_STATE"] = "";
  process.env["X_ARCHIVE_DOWNLOADS"] = "";
  expect(stateRoot()).toBe("x-archive");
  expect(downloadsRoot()).toBe("/data-xdg/x/downloads");
  process.env["X_ARCHIVE_STATE"] = "/state-override";
  process.env["X_ARCHIVE_DOWNLOADS"] = "/downloads-override";
  expect(storeDir("123")).toBe("/state-override/x-archive/stores/123");
  expect(stateDir("456")).toBe("/state-override/x-archive/state/456");
  expect(credentialsCachePath()).toBe("/state-override/x-archive/credentials.json");
  expect(downloadsRoot()).toBe("/downloads-override");
});

it("reads raw bytes and treats an absent file as absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "state-raw-"));
  try {
    const path = join(dir, "raw");
    expect(readRawFile(path)).toBeNull();
    writeFileSync(path, Buffer.from([0, 255]));
    expect(readRawFile(path)).toEqual(Buffer.from([0, 255]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
