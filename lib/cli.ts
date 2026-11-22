import { spawnSync } from "node:child_process";

export class UsageError extends Error {}

export type BackendKind = "helium" | "bctl";

export interface Backend {
  readonly kind: BackendKind;
  /** The bctl session this run launched or attached to; null on the helium path. */
  readonly session: string | null;
}

export const HELIUM_BACKEND: Backend = { kind: "helium", session: null };

export interface BackendInput {
  readonly backend?: string | undefined;
  readonly session?: string | undefined;
  readonly cdpUrl?: string | undefined;
}

export interface BackendPlan {
  readonly kind: BackendKind;
  readonly session: string;
  readonly explicitCdpUrl: string | null;
}

export interface ResolvedBackend {
  readonly backend: Backend;
  readonly cdpUrl: string;
}

export interface BackendConfig {
  readonly envPrefix: string;
  readonly defaultSession: string;
  readonly defaultCdpUrl: string;
  readonly bctlBinaryEnv: string;
  readonly signInHint: boolean;
}

export interface BackendResolver {
  plan(input?: BackendInput, env?: NodeJS.ProcessEnv): BackendPlan;
  resolve(input?: BackendInput, env?: NodeJS.ProcessEnv): ResolvedBackend;
}

export function createBackendResolver(config: BackendConfig): BackendResolver {
  const backendEnv = `${config.envPrefix}_BACKEND`;
  const sessionEnv = `${config.envPrefix}_SESSION`;
  const cdpUrlEnv = `${config.envPrefix}_CDP_URL`;

  function plan(input: BackendInput = {}, env: NodeJS.ProcessEnv = process.env): BackendPlan {
    const backend = input.backend ?? env[backendEnv] ?? "helium";
    if (backend !== "helium" && backend !== "bctl") {
      throw new Error(`Unknown backend "${backend}" (expected "helium" or "bctl").`);
    }
    return {
      kind: backend,
      session: input.session ?? env[sessionEnv] ?? config.defaultSession,
      explicitCdpUrl: input.cdpUrl ?? env[cdpUrlEnv] ?? null,
    };
  }

  function resolve(input: BackendInput = {}, env: NodeJS.ProcessEnv = process.env): ResolvedBackend {
    const planned = plan(input, env);
    if (planned.explicitCdpUrl !== null) {
      return {
        backend: { kind: planned.kind, session: planned.kind === "bctl" ? planned.session : null },
        cdpUrl: planned.explicitCdpUrl,
      };
    }
    if (planned.kind === "helium") {
      return { backend: HELIUM_BACKEND, cdpUrl: config.defaultCdpUrl };
    }
    const bctl = env[config.bctlBinaryEnv] ?? "bctl";
    const up = spawnSync(bctl, ["up", planned.session, "--profile", planned.session], {
      encoding: "utf8",
      timeout: 180_000,
    });
    if (up.error || up.status !== 0) {
      const detail = (up.stderr || up.stdout || String(up.error ?? "")).trim().slice(0, 400);
      throw new Error(
        `The bctl session "${planned.session}" is not available (${detail || "bctl failed"}). Run \`bctl doctor\`.`
        + (config.signInHint ? ` Sign in once with \`bctl profile login ${planned.session}\`.` : ""),
      );
    }
    const minted = spawnSync(bctl, ["cdp-url", planned.session], { encoding: "utf8", timeout: 30_000 });
    const cdpUrl = (minted.stdout ?? "").trim();
    if (minted.error || minted.status !== 0 || !cdpUrl) {
      const detail = (minted.stderr || String(minted.error ?? "")).trim().slice(0, 300);
      throw new Error(`bctl could not mint a CDP URL for session "${planned.session}"${detail ? ": " + detail : "."}`);
    }
    return { backend: { kind: "bctl", session: planned.session }, cdpUrl };
  }

  return { plan, resolve };
}

export interface ArgSchema {
  readonly values: readonly string[];
  readonly flags: readonly string[];
  readonly maxPositionals: number;
}

export interface ParsedCliArgs {
  readonly values: ReadonlyMap<string, string>;
  readonly flags: ReadonlySet<string>;
  readonly positional: readonly string[];
}

export function parseCliArgs(argv: readonly string[], schema: ArgSchema): ParsedCliArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  let optionsEnded = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-")) {
      const body = arg.startsWith("--") ? arg.slice(2) : arg.slice(1);
      const [name, ...pieces] = body.split("=");
      if (!name) throw new UsageError(`Unknown option: ${arg}`);
      if (schema.flags.includes(name)) {
        if (pieces.length > 0) throw new UsageError(`Option --${name} does not take a value`);
        if (flags.has(name)) throw new UsageError(`Repeated option: --${name}`);
        flags.add(name);
        continue;
      }
      if (schema.values.includes(name)) {
        if (values.has(name)) throw new UsageError(`Repeated option: --${name}`);
        const value = pieces.length > 0 ? pieces.join("=") : argv[i + 1];
        if (value === undefined || value.length === 0 || (pieces.length === 0 && value.startsWith("-"))) {
          throw new UsageError(`Missing value for --${name}`);
        }
        values.set(name, value);
        if (pieces.length === 0) i++;
        continue;
      }
      throw new UsageError(`Unknown option: ${arg}`);
    }
    if (positional.length >= schema.maxPositionals) throw new UsageError(`Unexpected argument: ${arg}`);
    positional.push(arg);
  }
  return { values, flags, positional };
}

export function installInterrupt(message: string, onInterrupt?: () => void): void {
  process.on("SIGINT", () => {
    process.stderr.write(`\n${message}\n`);
    if (onInterrupt) onInterrupt();
    else process.exit(130);
  });
}
