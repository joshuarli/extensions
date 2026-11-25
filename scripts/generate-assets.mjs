import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(repositoryRoot, "dist", "extension-suite");
const output = join(repositoryRoot, "lib", "generated", "assets.ts");

function filesUnder(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

if (!statSync(extensionRoot, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("Build the extension first with `make dist`.");
}

const files = filesUnder(extensionRoot).map((path) => [
  relative(extensionRoot, path).split("\\").join("/"),
  readFileSync(path).toString("base64"),
]);
const capture = readFileSync(join(extensionRoot, "inject", "onefile", "capture.js"), "utf8");
const loader = readFileSync(join(extensionRoot, "inject", "onefile", "loader.js"), "utf8");
const lines = [
  "export const EXTENSION_FILES: readonly (readonly [string, string])[] = [",
  ...files.map(([name, data]) => `  [${JSON.stringify(name)}, ${JSON.stringify(data)}],`),
  "];",
  `export const ONEFILE_CAPTURE_SOURCE = ${JSON.stringify(capture)};`,
  `export const ONEFILE_LOADER_SOURCE = ${JSON.stringify(loader)};`,
  "",
];
if (process.argv.includes("--check")) {
  const current = existsSync(output) ? readFileSync(output, "utf8") : null;
  if (current !== lines.join("\n")) {
    throw new Error(`${relative(repositoryRoot, output)} is stale: run pnpm run assets`);
  }
  console.log("Embedded runtime assets are current");
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, lines.join("\n"));
  console.log(`Generated ${relative(repositoryRoot, output)} with ${files.length} extension files`);
}
