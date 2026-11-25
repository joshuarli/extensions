import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { EXTENSION_FILES } from "./generated/assets.ts";

export { ONEFILE_CAPTURE_SOURCE, ONEFILE_LOADER_SOURCE } from "./generated/assets.ts";

export function suiteExtensionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  return join(base, "browser-extensions", "extension-suite");
}

export function materializeExtension(env: NodeJS.ProcessEnv = process.env): string {
  const root = suiteExtensionPath(env);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [name, encoded] of EXTENSION_FILES) {
    const path = join(root, name),
      temporary = `${path}.tmp`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temporary, Buffer.from(encoded, "base64"));
    renameSync(temporary, path);
  }
  return root;
}
