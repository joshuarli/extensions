import { describe, expect, it } from "vitest";
import { planBackend } from "../src/backend.ts";

const cleanEnv = { PATH: "/usr/bin" } as NodeJS.ProcessEnv;

describe("planBackend", () => {
  it("defaults to helium on 127.0.0.1:9222", () => {
    const plan = planBackend({}, cleanEnv);
    expect(plan).toEqual({ kind: "helium", session: "xarchive", explicitCdpUrl: null });
  });

  it("plans a helium attach when only a cdp url is given", () => {
    expect(planBackend({ cdpUrl: "http://127.0.0.1:9222" }, cleanEnv).explicitCdpUrl).toBe("http://127.0.0.1:9222");
  });

  it("uses the xarchive bctl session by default when the backend is bctl", () => {
    expect(planBackend({ backend: "bctl" }, cleanEnv)).toEqual({ kind: "bctl", session: "xarchive", explicitCdpUrl: null });
  });

  it("honors X_ARCHIVE_BACKEND and X_ARCHIVE_SESSION", () => {
    const env = { ...cleanEnv, X_ARCHIVE_BACKEND: "bctl", X_ARCHIVE_SESSION: "archive-vm" } as NodeJS.ProcessEnv;
    expect(planBackend({}, env)).toEqual({ kind: "bctl", session: "archive-vm", explicitCdpUrl: null });
  });

  it("flags win over env, env wins over defaults", () => {
    const env = { X_ARCHIVE_BACKEND: "helium", X_ARCHIVE_SESSION: "envsession", X_ARCHIVE_CDP_URL: "http://env:1" } as NodeJS.ProcessEnv;
    expect(planBackend({ backend: "bctl", session: "flagsession", cdpUrl: "http://flag:2" }, env))
      .toEqual({ kind: "bctl", session: "flagsession", explicitCdpUrl: "http://flag:2" });
  });

  it("treats an explicit cdp url as attach mode and keeps the bctl fallback policy", () => {
    const env = { X_ARCHIVE_CDP_URL: "http://127.0.0.1:9911" } as NodeJS.ProcessEnv;
    expect(planBackend({ backend: "bctl" }, env).explicitCdpUrl).toBe("http://127.0.0.1:9911");
    expect(planBackend({ cdpUrl: "http://127.0.0.1:9922" }, cleanEnv)).toEqual({ kind: "helium", session: "xarchive", explicitCdpUrl: "http://127.0.0.1:9922" });
  });

  it("attaches an exec job's CDP capability only on the bctl backend", () => {
    const env = { BCTL_CDP_URL: "http://localhost:1234" } as NodeJS.ProcessEnv;
    expect(planBackend({ backend: "bctl" }, env).explicitCdpUrl).toBe("http://localhost:1234");
    expect(planBackend({}, env).explicitCdpUrl).toBeNull();
  });

  it("rejects an unknown backend with a clear error", () => {
    expect(() => planBackend({ backend: "smolvm" }, cleanEnv)).toThrow('Unknown backend "smolvm"');
  });
});
