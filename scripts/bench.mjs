import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const tier = args.find((arg) => arg.startsWith("--tier="))?.slice(7) ?? "change";
const workload = args.find((arg) => arg.startsWith("--workload="))?.slice(11) ?? "small";
const area = args.find((arg) => arg.startsWith("--area="))?.slice(7) ?? "onefile";
const skip = args.find((arg) => arg.startsWith("--skip="))?.slice(7);
const list = args.includes("--list");
const check = args.includes("--check");
const dry = args.includes("--dry-run");
const allowed = new Set(["small", "article", "image-heavy", "css-heavy"]);
if (args.some((arg) => !["--list", "--check", "--dry-run"].includes(arg) && !arg.startsWith("--tier=") && !arg.startsWith("--workload=") && !arg.startsWith("--area=") && !arg.startsWith("--skip=")) || !["edit", "change"].includes(tier) || !allowed.has(workload) || area !== "onefile" || (skip !== undefined && (!allowed.has(skip) || skip === workload))) {
  console.error("Select --tier=edit|change and --workload=small|article|image-heavy|css-heavy");
  process.exit(2);
}
if (list) {
  console.log("edit: runner selection checks (seconds); change: small, article, image-heavy, css-heavy (local Chromium; estimated minutes). Full is manual only.");
  process.exit(0);
}
const command = ["exec", "playwright", "test", "--config", "extension-onefile/playwright.perf.config.ts", "--workers=1", "-g", `perf ${workload}:`];
if (dry) {
  console.log(tier === "edit" ? "node scripts/bench.mjs --list" : `BENCH_ONEFILE_ONLY=1 pnpm ${command.join(" ")}`);
  console.log("Excluded: upstream comparison, other fixtures, Full");
  process.exit(0);
}
if (tier === "edit") {
  const run = (...more) => spawnSync(process.execPath, ["scripts/bench.mjs", ...more], { encoding: "utf8" });
  if (run("--list").status !== 0 || run("--tier=full").status !== 2 || run("--workload=missing").status !== 2 || run("--area=missing").status !== 2 || run("--skip=small").status !== 2 || run("--dry-run").status !== 0) process.exit(1);
  console.log("Selection and dry-run checks passed; Full excluded.");
  process.exit(0);
}
const required = ["dist/extension-suite/inject/onefile/capture.js", "dist/extension-suite/inject/onefile/loader.js"];
const fixtures = { small: "text-unicode.html", article: "article.html", "image-heavy": "resources.html", "css-heavy": "styles.html" };
required.push(`extension-onefile/test/fixtures/${fixtures[workload]}`, chromium.executablePath());
const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing production bundles: ${missing.join(", ")}; run pnpm run dist before the selected workload.`);
  process.exit(1);
}
for (const [source, bundle] of [["extension-onefile/src/inject/capture.ts", required[0]], ["extension-onefile/src/inject/loader.ts", required[1]]]) {
  if (statSync(source).mtimeMs > statSync(bundle).mtimeMs) console.warn(`Warning: ${bundle} is older than ${source}; rebuild if unintended.`);
}
console.log("Host readiness not established; timings are observations, not a performance verdict. Upstream comparison and other fixtures excluded.");
if (check) process.exit(0);
const output = join(".work", "tmp", `bench-${Date.now()}`);
mkdirSync(output, { recursive: true });
const start = Date.now();
const result = spawnSync("pnpm", command, { encoding: "utf8", env: { ...process.env, BENCH_ONEFILE_ONLY: "1" } });
writeFileSync(join(output, "output.log"), (result.stdout ?? "") + (result.stderr ?? ""));
console.log(result.stdout ?? "", result.stderr ?? "");
console.log(`workload=${workload} exit=${result.status} duration_ms=${Date.now() - start} output=${output}/output.log; no comparison verdict`);
process.exit(result.status ?? 1);
