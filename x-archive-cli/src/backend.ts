import { createBackendResolver } from "../../lib/cli.ts";

export type { Backend, BackendInput, BackendKind, BackendPlan, ResolvedBackend } from "../../lib/cli.ts";
export { HELIUM_BACKEND } from "../../lib/cli.ts";

const resolver = createBackendResolver({
  envPrefix: "X_ARCHIVE",
  defaultSession: "xarchive",
  defaultCdpUrl: "http://127.0.0.1:9222",
  bctlBinaryEnv: "X_ARCHIVE_BCTL",
  signInHint: true,
});

export const planBackend = resolver.plan;
export const resolveBackend = resolver.resolve;
