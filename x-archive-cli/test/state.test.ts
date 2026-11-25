import { afterEach, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { credentialsCachePath, downloadsRoot, readRawFile, stateDir, stateRoot, storeDir, writeJsonFile } from "../src/state.ts";

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


it("writes JSON with a requested private mode and terminating newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "state-write-"));
  try {
    const path = join(dir, "nested", "state.json");
    writeJsonFile(path, { count: 2 }, 0o400);
    expect(readFileSync(path, "utf8")).toBe('{\n  "count": 2\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o400);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("leaves the old archive and the staged bytes intact when the rename fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "state-rename-"));
  try {
    const path = join(dir, "archive.json");
    mkdirSync(path);
    const oldBytes = '{"old":true}\n';
    writeFileSync(join(path, "previous.json"), oldBytes);
    expect(() => writeJsonFile(path, { count: 2 })).toThrow(expect.objectContaining({ code: "EISDIR" }));
    expect(readFileSync(join(path, "previous.json"), "utf8")).toBe(oldBytes);
    const staging = `${path}.tmp.${process.pid}`;
    expect(existsSync(staging)).toBe(false);

    rmSync(path, { recursive: true, force: true });
    writeJsonFile(path, { count: 3 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 3 });
    expect(existsSync(staging)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("overwrites staging bytes left by an interrupted write before committing", () => {
  const dir = mkdtempSync(join(tmpdir(), "state-staging-"));
  try {
    const path = join(dir, "archive.json");
    writeJsonFile(path, { count: 1 });
    writeFileSync(`${path}.tmp.${process.pid}`, "{interrupted");
    writeJsonFile(path, { count: 2 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ count: 2 });
    expect(existsSync(`${path}.tmp.${process.pid}`)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("keeps a complete archive when concurrent processes replace the same file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "state-concurrent-"));
  try {
    const path = join(dir, "archive.json"),
      child = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "write-json-child.ts"),
      writers = ["alpha", "beta", "gamma", "delta"],
      children = writers.map((id) => new Promise<number>((resolve, reject) => {
        const spawned = spawn(process.execPath, [child, path, id, "40"], { stdio: "ignore" });
        spawned.once("error", reject);
        spawned.once("close", (code) => resolve(code ?? -1));
      }));
    expect(await Promise.all(children)).toEqual([0, 0, 0, 0]);
    const final: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(final).toMatchObject({
      writer: expect.any(String),
      round: 39,
      blob: "x".repeat(200_000),
    });
    expect(writers).toContain((final as { writer: string }).writer);
    expect(readdirSync(dir)).toEqual(["archive.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
