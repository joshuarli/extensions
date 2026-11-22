import { createBackendResolver } from "../../lib/cli.ts";

export type { Backend, BackendInput, BackendKind, BackendPlan, ResolvedBackend } from "../../lib/cli.ts";
export { HELIUM_BACKEND } from "../../lib/cli.ts";

const resolver = createBackendResolver({
  envPrefix: "ONEFILE",
  defaultSession: "onefile",
  defaultCdpUrl: "http://127.0.0.1:9222",
  bctlBinaryEnv: "ONEFILE_BCTL",
  signInHint: false,
});

export const planBackend = resolver.plan;
export const resolveBackend = resolver.resolve;
