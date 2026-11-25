import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseCliArgs, UsageError, type ArgSchema } from "../../lib/cli.ts";

export { UsageError };

const options = [
  { name: "out", value: "DIR", description: "output directory (ONEFILE_OUT or XDG_DATA_HOME; default ~/.local/share/onefile)" },
  { name: "backend", value: "helium|bctl", description: "browser backend (ONEFILE_BACKEND; default helium)" },
  { name: "session", value: "NAME", description: "bctl session (ONEFILE_SESSION; default onefile)" },
  { name: "cdp-url", value: "URL", description: "attach to CDP (ONEFILE_CDP_URL; default http://127.0.0.1:9222)" },
] as const;

const schema: ArgSchema = { values: options.map((option) => option.name), flags: [], maxPositionals: 1 };
export interface SaveOptions { url: string; out: string; backend: string; session: string; cdpUrl: string | undefined }
export type Command = { kind: "help" } | { kind: "version" } | { kind: "save"; options: SaveOptions };
export const help = `onefile — save a web page as a self-extracting archive\n\nUsage:\n  onefile save <url> [options]\n\nOptions:\n${options.map((o) => `  --${o.name} ${o.value}  ${o.description}`).join("\n")}\n  --help, -h  show help\n  --version, -v  show version\n\nExample:\n  pnpm onefile save https://example.com/ --out ./saved\n`;
export function outputDirectory(out: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return resolve(out ?? (env["ONEFILE_OUT"] || join(env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"), "onefile")));
}
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Command {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) return { kind: "help" };
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) return { kind: "version" };
  if (argv[0] !== "save") throw new UsageError(`Unknown command: ${argv[0]}`);
  const parsed = parseCliArgs(argv.slice(1), schema);
  const url = parsed.positional[0];
  if (!url) throw new UsageError("Missing URL for save");
  try { const candidate = new URL(url); if (candidate.protocol !== "http:" && candidate.protocol !== "https:") throw new Error(); }
  catch { throw new UsageError(`Invalid HTTP(S) URL: ${url}`); }
  const backend = parsed.values.get("backend") ?? env["ONEFILE_BACKEND"] ?? "helium";
  if (backend !== "helium" && backend !== "bctl") throw new UsageError(`Unknown backend: ${backend}`);
  return { kind: "save", options: {
    url,
    out: outputDirectory(parsed.values.get("out"), env),
    backend,
    session: parsed.values.get("session") ?? env["ONEFILE_SESSION"] ?? "onefile",
    cdpUrl: parsed.values.get("cdp-url") ?? env["ONEFILE_CDP_URL"],
  } };
}
