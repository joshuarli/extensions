import { describe, expect, it } from "vitest";
import { planBackend } from "../src/backend.ts";

const cleanEnv = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;

describe("onefile planBackend", () => {
  it("defaults to helium with the onefile session", () => {
    expect(planBackend({}, cleanEnv)).toEqual({ kind: "helium", session: "onefile", explicitCdpUrl: null });
  });

  it("plans a helium attach when only a cdp url is given", () => {
    expect(planBackend({ cdpUrl: "http://127.0.0.1:9222" }, cleanEnv).explicitCdpUrl).toBe("http://127.0.0.1:9222");
  });

  it("uses the onefile bctl session by default when the backend is bctl", () => {
    expect(planBackend({ backend: "bctl" }, cleanEnv)).toEqual({ kind: "bctl", session: "onefile", explicitCdpUrl: null });
  });

  it("honors ONEFILE_BACKEND and ONEFILE_SESSION", () => {
    const env = { ...cleanEnv, ONEFILE_BACKEND: "bctl", ONEFILE_SESSION: "work" } as NodeJS.ProcessEnv;
    expect(planBackend({}, env)).toEqual({ kind: "bctl", session: "work", explicitCdpUrl: null });
  });

  it("flags win over env, env wins over defaults", () => {
    const env = {
      ONEFILE_BACKEND: "helium",
      ONEFILE_SESSION: "envsession",
      ONEFILE_CDP_URL: "http://env:1",
    } as NodeJS.ProcessEnv;
    expect(planBackend({ backend: "bctl", session: "flagsession", cdpUrl: "http://flag:2" }, env))
      .toEqual({ kind: "bctl", session: "flagsession", explicitCdpUrl: "http://flag:2" });
  });

  it("treats an explicit cdp url as attach mode and keeps the bctl session", () => {
    const env = { ONEFILE_CDP_URL: "http://127.0.0.1:9911" } as NodeJS.ProcessEnv;
    expect(planBackend({ backend: "bctl" }, env).explicitCdpUrl).toBe("http://127.0.0.1:9911");
    expect(planBackend({}, cleanEnv)).toEqual({ kind: "helium", session: "onefile", explicitCdpUrl: null });
  });

  it("rejects an unknown backend with a clear error", () => {
    expect(() => planBackend({ backend: "smolvm" }, cleanEnv)).toThrow('Unknown backend "smolvm"');
  });
});
