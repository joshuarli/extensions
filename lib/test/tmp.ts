import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

export function makeTempDir(prefix: string): string {
  const root = join(process.cwd(), ".work/tmp");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}
