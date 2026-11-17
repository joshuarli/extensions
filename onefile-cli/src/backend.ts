import { spawnSync } from "node:child_process";
import type { SaveOptions } from "./args.ts";

export function resolveCdpUrl(options: SaveOptions, env: NodeJS.ProcessEnv = process.env): string {
  if (options.cdpUrl !== undefined) return options.cdpUrl;
  if (options.backend === "helium") return "http://127.0.0.1:9222";
  const binary = env["ONEFILE_BCTL"] ?? "bctl";
  const up = spawnSync(binary, ["up", options.session, "--profile", options.session], { encoding: "utf8", timeout: 180_000 });
  if (up.error || up.status !== 0) {
    const detail = (up.stderr || up.stdout || String(up.error ?? "bctl failed")).trim().slice(0, 400);
    throw new Error(`The bctl session "${options.session}" is not available (${detail}). Run bctl doctor.`);
  }
  const minted = spawnSync(binary, ["cdp-url", options.session], { encoding: "utf8", timeout: 30_000 });
  const url = (minted.stdout ?? "").trim();
  if (minted.error || minted.status !== 0 || !url) throw new Error(`bctl could not mint a CDP URL for session "${options.session}": ${(minted.stderr || String(minted.error ?? "empty URL")).trim()}`);
  return url;
}
