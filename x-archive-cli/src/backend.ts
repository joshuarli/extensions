import { spawnSync } from "node:child_process";

const DEFAULT_CDP_URL = process.env["X_ARCHIVE_CDP_URL"] ?? "http://127.0.0.1:9222";

const DEFAULT_SESSION = "xarchive";

type BackendKind = "helium" | "bctl";

export interface Backend {
  kind: BackendKind;
  /** The bctl session this run launched or attached to; null on the helium path. */
  session: string | null;
}

export const HELIUM_BACKEND: Backend = { kind: "helium", session: null };

export interface BackendInput {
  backend?: string | undefined;
  session?: string | undefined;
  cdpUrl?: string | undefined;
}

export interface BackendPlan {
  kind: BackendKind;
  session: string;
  explicitCdpUrl: string | null;
}

export function planBackend(input: BackendInput, env: NodeJS.ProcessEnv = process.env): BackendPlan {
  const backend = input.backend ?? env["X_ARCHIVE_BACKEND"] ?? "helium";
  if (backend !== "helium" && backend !== "bctl") {
    throw new Error(`Unknown backend "${backend}" (expected "helium" or "bctl").`);
  }
  const session = input.session ?? env["X_ARCHIVE_SESSION"] ?? DEFAULT_SESSION;
  const cdpUrl = input.cdpUrl ?? env["X_ARCHIVE_CDP_URL"] ?? (backend === "bctl" ? env["BCTL_CDP_URL"] : undefined) ?? null;
  return { kind: backend, session, explicitCdpUrl: cdpUrl };
}

export interface ResolvedBackend {
  backend: Backend;
  cdpUrl: string;
}

export function resolveBackend(input: BackendInput, env: NodeJS.ProcessEnv = process.env): ResolvedBackend {
  const plan = planBackend(input, env);
  if (plan.explicitCdpUrl !== null) {
    return { backend: { kind: plan.kind, session: plan.kind === "bctl" ? plan.session : null }, cdpUrl: plan.explicitCdpUrl };
  }
  if (plan.kind === "helium") {
    return { backend: HELIUM_BACKEND, cdpUrl: DEFAULT_CDP_URL };
  }
  const bctl = env["X_ARCHIVE_BCTL"] ?? "bctl";
  const up = spawnSync(bctl, ["up", plan.session, "--profile", plan.session], {
    encoding: "utf8",
    timeout: 180_000,
  });
  if (up.error || up.status !== 0) {
    const detail = (up.stderr || up.stdout || String(up.error ?? "")).trim().slice(0, 400);
    throw new Error(
      `The bctl session "${plan.session}" is not available (${detail || "bctl failed"}). `
      + "Run `bctl doctor`; sign in once with `bctl profile login " + plan.session + "`.",
    );
  }
  const minted = spawnSync(bctl, ["cdp-url", plan.session], { encoding: "utf8", timeout: 30_000 });
  const cdpUrl = (minted.stdout ?? "").trim();
  if (minted.error || minted.status !== 0 || !cdpUrl) {
    const detail = (minted.stderr || String(minted.error ?? "")).trim().slice(0, 300);
    throw new Error(`bctl could not mint a CDP URL for session "${plan.session}"${detail ? ": " + detail : "."}`);
  }
  return { backend: { kind: "bctl", session: plan.session }, cdpUrl };
}
