import { describe, expect, it } from "vitest";
import { createBackendResolver, createInterruptController, HELIUM_BACKEND, parseCliArgs, type ArgSchema, type BackendConfig } from "../cli.ts";

const xConfig: BackendConfig = {
  envPrefix: "X_ARCHIVE",
  defaultSession: "xarchive",
  defaultCdpUrl: "http://127.0.0.1:9222",
  bctlBinaryEnv: "X_ARCHIVE_BCTL",
  signInHint: true,
};
const onefileConfig: BackendConfig = {
  ...xConfig,
  envPrefix: "ONEFILE",
  defaultSession: "onefile",
  bctlBinaryEnv: "ONEFILE_BCTL",
  signInHint: false,
};

const cleanEnv = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;

describe("createBackendResolver", () => {
  it("defaults to helium at the configured CDP URL", () => {
    const resolver = createBackendResolver(xConfig);
    expect(resolver.plan({}, cleanEnv)).toEqual({ kind: "helium", session: "xarchive", explicitCdpUrl: null });
    expect(resolver.resolve({}, cleanEnv)).toEqual({ backend: HELIUM_BACKEND, cdpUrl: "http://127.0.0.1:9222" });
  });

  it("attaches to an explicit CDP URL without launching bctl", () => {
    const resolver = createBackendResolver(xConfig);
    expect(resolver.resolve({ cdpUrl: "http://127.0.0.1:9911" }, cleanEnv)).toEqual({
      backend: HELIUM_BACKEND,
      cdpUrl: "http://127.0.0.1:9911",
    });
  });

  it("keeps the bctl session when attaching to an explicit CDP URL", () => {
    const resolver = createBackendResolver(onefileConfig);
    expect(resolver.resolve({ backend: "bctl", cdpUrl: "http://vm:9222" }, cleanEnv)).toEqual({
      backend: { kind: "bctl", session: "onefile" },
      cdpUrl: "http://vm:9222",
    });
  });

  it("applies the same flag > env > default precedence for every config", () => {
    for (const [config, prefix] of [[xConfig, "X_ARCHIVE"], [onefileConfig, "ONEFILE"]] as const) {
      const resolver = createBackendResolver(config);
      const env = {
        ...cleanEnv,
        [`${prefix}_BACKEND`]: "bctl",
        [`${prefix}_SESSION`]: "env-session",
        [`${prefix}_CDP_URL`]: "http://env:1",
      } as NodeJS.ProcessEnv;
      expect(resolver.plan({}, env)).toEqual({ kind: "bctl", session: "env-session", explicitCdpUrl: "http://env:1" });
      expect(resolver.plan({ backend: "helium", session: "flag-session", cdpUrl: "http://flag:2" }, env)).toEqual({
        kind: "helium",
        session: "flag-session",
        explicitCdpUrl: "http://flag:2",
      });
    }
  });

  it("defaults a bctl plan to the configured session", () => {
    expect(createBackendResolver(onefileConfig).plan({ backend: "bctl" }, cleanEnv)).toEqual({
      kind: "bctl",
      session: "onefile",
      explicitCdpUrl: null,
    });
  });

  it("rejects an unknown backend", () => {
    expect(() => createBackendResolver(xConfig).plan({ backend: "smolvm" }, cleanEnv)).toThrow('Unknown backend "smolvm"');
  });
});

describe("createInterruptController", () => {
  it("aborts once on SIGINT and removes its listener on close", () => {
    const before = process.listenerCount("SIGINT");
    const interrupt = createInterruptController("stopping");
    expect(interrupt.stopped()).toBe(false);
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    process.emit("SIGINT");
    expect(interrupt.stopped()).toBe(true);
    expect(interrupt.signal.aborted).toBe(true);
    interrupt.close();
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

const schema: ArgSchema = {
  values: ["out", "backend"],
  flags: ["no-render", "no-context"],
  maxPositionals: 1,
};

describe("parseCliArgs", () => {
  it("accepts both --name value and --name=value forms", () => {
    const split = parseCliArgs(["self", "--out", "./saved", "--backend", "bctl"], schema);
    const joined = parseCliArgs(["self", "--out=./saved", "--backend=bctl"], schema);
    expect(split).toEqual(joined);
    expect(split.values.get("out")).toBe("./saved");
    expect(split.values.get("backend")).toBe("bctl");
    expect(split.positional).toEqual(["self"]);
  });

  it("reads flags without values", () => {
    const parsed = parseCliArgs(["self", "--no-render", "--no-context"], schema);
    expect([...parsed.flags]).toEqual(["no-render", "no-context"]);
  });

  it("stops parsing options after --", () => {
    const parsed = parseCliArgs(["--", "--out", "./saved"], { ...schema, maxPositionals: 2 });
    expect(parsed.positional).toEqual(["--out", "./saved"]);
    expect(parsed.values.size).toBe(0);
  });

  it("rejects unknown, repeated, and valueless options", () => {
    expect(() => parseCliArgs(["--bad"], schema)).toThrow("Unknown option: --bad");
    expect(() => parseCliArgs(["--out=a", "--out=b"], schema)).toThrow("Repeated option: --out");
    expect(() => parseCliArgs(["--no-render", "--no-render"], schema)).toThrow("Repeated option: --no-render");
    expect(() => parseCliArgs(["--out"], schema)).toThrow("Missing value for --out");
    expect(() => parseCliArgs(["--out=--other"], schema)).not.toThrow();
    expect(() => parseCliArgs(["--no-render=x"], schema)).toThrow("Option --no-render does not take a value");
  });

  it("caps positional arguments", () => {
    expect(() => parseCliArgs(["one", "two"], schema)).toThrow("Unexpected argument: two");
  });
});
