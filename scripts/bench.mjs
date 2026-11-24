import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { runAttributed } from "./bench-process.mjs";
import { pairedVerdict } from "./bench-budget.mjs";

const args = process.argv.slice(2);
const option = (name) => args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
const tier = option("tier")[0] ?? "change";
const workloadsArg = option("workload");
const areasArg = option("area");
const skips = option("skip");
const list = args.includes("--list");
const check = args.includes("--check");
const dry = args.includes("--dry-run");
const budgetArg = option("budget")[0];
const allowedTiers = ["edit", "change", "scenario"];
const comparatorPath = process.env["BENCH_COMPARATOR_FILE"] ?? "scripts/bench-comparator.json";
const comparator = JSON.parse(readFileSync(comparatorPath, "utf8"));

const fixtures = {
  small: "text-unicode.html",
  article: "article.html",
  "image-heavy": "resources.html",
  "css-heavy": "styles.html",
};

const registry = [
  ...Object.entries(fixtures).map(([name, file]) => ({
    name,
    area: "onefile",
    tier: "change",
    purpose: `browser save of ${name} page`,
    requirements: ["onefile-bundles", "onefile-fixture", "browser"],
  })),
  {
    name: "onefile-assemble",
    area: "onefile-cli",
    tier: "change",
    purpose: "CLI archive assembly from a real article fixture",
    requirements: ["onefile-bundles"],
  },
  {
    name: "x-export",
    area: "x-archive",
    tier: "change",
    purpose: "X conversation parse and 500-record export re-read",
    requirements: ["x-fixture"],
  },
  {
    name: "extension-startup",
    area: "extension",
    tier: "change",
    purpose: "installed service-worker startup in a fresh Chromium profile",
    requirements: ["suite-bundle", "browser"],
  },
  {
    name: "upstream-compare",
    area: "onefile",
    tier: "scenario",
    purpose: "interleaved comparison against the pinned upstream build",
    requirements: ["comparator", "onefile-bundles", "browser"],
  },
];

const names = new Set(registry.map((workload) => workload.name));
const areaNames = new Set(registry.map((workload) => workload.area));

function select() {
  if (tier === "full") return { error: "Full is manual only; choose --tier=edit|change|scenario." };
  if (!allowedTiers.includes(tier)) return { error: "Unknown tier." };
  if (workloadsArg.some((name) => !names.has(name))) return { error: "Unknown workload." };
  if (areasArg.some((area) => !areaNames.has(area))) return { error: "Unknown area." };
  if (skips.some((name) => !names.has(name))) return { error: "Unknown skip name." };
  const ceiling = allowedTiers.indexOf(tier);
  let selected = registry.filter((workload) => allowedTiers.indexOf(workload.tier) <= ceiling);
  if (workloadsArg.length) selected = selected.filter((workload) => workloadsArg.includes(workload.name));
  if (areasArg.length) selected = selected.filter((workload) => areasArg.includes(workload.area));
  selected = selected.filter((workload) => !skips.includes(workload.name));
  if (!selected.length) return { error: "Selection matches no workload." };
  return { selected };
}

function unknownFlags() {
  const known = new Set(["list", "check", "dry-run", "budget", "tier", "workload", "area", "skip"]);
  return args.some((arg) => !arg.startsWith("--") || !known.has(arg.split("=")[0].slice(2)));
}

function usage() {
  console.log("edit: runner selection checks; change: browser saves, CLI assembly, X export; scenario: paired comparator (manual Full only).");
  for (const workload of registry) {
    console.log(`${workload.tier}\t${workload.area}\t${workload.name}\t${workload.purpose}\testimated seconds-minutes`);
  }
  console.log(`comparator: ${comparator.name}@${comparator.version} (${comparator.path})`);
}

function hostReadiness() {
  const result = spawnSync("perf-gate-ready", ["-1"], { encoding: "utf8" });
  if (result.status === 0) return "quiet";
  if (result.status === 75) return "busy";
  return "unreadable";
}

function diskFreeGiB() {
  const result = spawnSync("df", ["-k", "."], { encoding: "utf8" });
  const line = (result.stdout ?? "").split("\n")[1] ?? "";
  const available = Number(line.trim().split(/\s+/u)[3]);
  return Number.isFinite(available) ? Math.round((available / 1024 / 1024) * 10) / 10 : null;
}

function preflight(selected) {
  const problems = [];
  const warnings = [];
  const requirements = new Set(selected.flatMap((workload) => workload.requirements));
  if (requirements.has("onefile-bundles")) {
    for (const bundle of ["dist/extension-suite/inject/onefile/capture.js", "dist/extension-suite/inject/onefile/loader.js"]) {
      if (!existsSync(bundle)) problems.push(`${bundle} missing: run pnpm run dist`);
      else {
        const source = bundle.includes("capture") ? "onefile-core/src/inject/capture.ts" : "extension-onefile/src/inject/loader.ts";
        if (statSync(source).mtimeMs > statSync(bundle).mtimeMs) warnings.push(`${bundle} is older than ${source}; rebuild if unintended`);
      }
    }
  }
  if (requirements.has("onefile-fixture")) {
    for (const workload of selected) {
      if (!workload.name || !(workload.name in fixtures)) continue;
      const path = `extension-onefile/test/fixtures/${fixtures[workload.name]}`;
      if (!existsSync(path)) problems.push(`${path} missing: fixture not pinned in this checkout`);
    }
  }
  if (requirements.has("x-fixture") && !existsSync("x-archive-cli/test/fixtures/conversation-page.html")) {
    problems.push("x-archive-cli/test/fixtures/conversation-page.html missing: fixture not pinned in this checkout");
  }
  if (requirements.has("suite-bundle") && !existsSync("dist/extension-suite/manifest.json")) {
    problems.push("dist/extension-suite/manifest.json missing: run pnpm run dist");
  }
  if (requirements.has("browser")) {
    const result = spawnSync(process.execPath, ["-e", "import('playwright').then((m)=>process.stdout.write(m.chromium.executablePath()))"], { encoding: "utf8" });
    const path = (result.stdout ?? "").trim();
    if (result.status !== 0 || !existsSync(path)) problems.push("Chromium missing: install the Playwright browser before browser workloads");
  }
  if (selected.some((workload) => workload.tier === "scenario")) {
    if (!existsSync(comparator.path)) problems.push(`${comparator.name}@${comparator.version} missing at ${comparator.path}: provision the pinned comparator`);
    else {
      const manifestPath = join(comparator.path, "package.json");
      const version = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")).version : null;
      if (version !== comparator.version) problems.push(`${comparator.path} is ${version ?? "unknown"}, expected ${comparator.version}`);
    }
  }
  const free = diskFreeGiB();
  if (free !== null && free < 2) problems.push(`less than 2 GiB free disk (${free} GiB)`);
  const host = hostReadiness();
  return { problems, warnings, host, free };
}

function printPreflight(selected, ready) {
  for (const warning of ready.warnings) console.log(`Warning: ${warning}`);
  console.log(`Host: ${ready.host}; free disk: ${ready.free ?? "unknown"} GiB. Timing validity: ${ready.host === "quiet" ? "quiet host" : "busy host: ratios only"}.`);
  console.log(`Selected: ${selected.map((workload) => `${workload.area}/${workload.name}`).join(", ")}.`);
}

function dryRun(selected) {
  for (const workload of selected) {
    if (workload.area === "onefile") console.log(`BENCH_ONEFILE_ONLY=1 pnpm exec playwright test --config extension-onefile/playwright.perf.config.ts --workers=1 -g 'perf ${workload.name}:'`);
    else console.log(`node scripts/bench-workload.mjs ${workload.name} .work/tmp/bench-<date>/${workload.name}.json 5`);
  }
  const excluded = ["Full (manual only)"];
  if (!selected.some((workload) => workload.tier === "scenario")) excluded.push(`upstream comparison (${comparator.name}@${comparator.version})`);
  for (const name of skips) excluded.push(`skip ${name}`);
  console.log(`Excluded: ${excluded.join(", ")}`);
}

function runEdit() {
  const run = (...more) => spawnSync(process.execPath, ["scripts/bench.mjs", ...more], { encoding: "utf8" });
  const checks = [
    ["--list", 0],
    ["--tier=full", 2],
    ["--workload=missing", 2],
    ["--area=missing", 2],
    ["--skip=small", 0],
    ["--workload=small --skip=small", 2],
    ["--dry-run", 0],
    ["--bogus", 2],
  ];
  for (const [flagString, expected] of checks) {
    const result = run(...flagString.split(" "));
    if (result.status !== expected) {
      console.error(`Edit check failed for ${flagString}: ${result.status} != ${expected}`);
      process.exit(1);
    }
  }
  const verdict = pairedVerdict(
    [{ cpuSeconds: 10, work: 5 }, { cpuSeconds: 11, work: 5 }, { cpuSeconds: 10, work: 5 }, { cpuSeconds: 12, work: 5 }, { cpuSeconds: 10, work: 5 }],
    [{ cpuSeconds: 10.5, work: 5 }, { cpuSeconds: 11, work: 5 }, { cpuSeconds: 10, work: 5 }, { cpuSeconds: 12.5, work: 5 }, { cpuSeconds: 10.5, work: 5 }],
  );
  if (verdict.verdict !== "within") {
    console.error(`Budget check failed: ${JSON.stringify(verdict)}`);
    process.exit(1);
  }
  console.log("Selection, dry-run, exclusion and paired-budget checks passed; Full excluded.");
}

function runOnefile(workload, output) {
  const command = ["exec", "playwright", "test", "--config", "extension-onefile/playwright.perf.config.ts", "--workers=1"];
  if (workload.tier !== "scenario") command.push("-g", `perf ${workload.name}:`);
  const result = spawnSync("pnpm", command, {
    encoding: "utf8",
    env: { ...process.env, ...(workload.tier === "scenario" ? {} : { BENCH_ONEFILE_ONLY: "1" }) },
  });
  writeFileSync(join(output, `${workload.name}.log`), (result.stdout ?? "") + (result.stderr ?? ""));
  const source = join(".work", "tmp", "perf-results", `${workload.name}.json`);
  if (existsSync(source)) writeFileSync(join(output, `${workload.name}.json`), readFileSync(source));
  return { status: result.status ?? 1, samples: existsSync(source) ? JSON.parse(readFileSync(source, "utf8")) : [] };
}

async function runNodeWorkload(workload, output) {
  const resultPath = join(output, `${workload.name}.json`);
  const attributed = await runAttributed(process.execPath, ["scripts/bench-workload.mjs", workload.name, resultPath, "5"]);
  writeFileSync(join(output, `${workload.name}.attribution.json`), JSON.stringify({
    wallMs: attributed.wallMs,
    cpuSeconds: attributed.cpuSeconds,
    peakRssKiB: attributed.peakRssKiB,
    exitCode: attributed.exitCode,
    stderr: attributed.stderr.trim(),
  }, null, 2));
  const rawSamples = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")).samples : [];
  const samples = rawSamples.map((sample) => ({
    ...sample,
    cpuSeconds: attributed.cpuSeconds != null ? attributed.cpuSeconds / Math.max(1, rawSamples.length) : null,
  }));
  if (rawSamples.length) writeFileSync(resultPath, `${JSON.stringify({ name: workload.name, samples }, null, 2)}\n`);
  return { status: attributed.exitCode, samples, attributed };
}

async function main() {
  if (unknownFlags()) {
    console.error("Unknown argument.");
    process.exit(2);
  }
  if (budgetArg) {
    const [baselinePath, candidatePath] = budgetArg.split(",");
    if (!baselinePath || !candidatePath || !existsSync(baselinePath) || !existsSync(candidatePath)) {
      console.error("--budget needs two existing result JSON paths: BASE,CAND");
      process.exit(2);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
    const verdict = pairedVerdict(baseline.samples ?? baseline, candidate.samples ?? candidate);
    console.log(`Budget: ${verdict.verdict} ${JSON.stringify(verdict)}`);
    process.exit(verdict.verdict === "regression" ? 1 : 0);
  }
  if (list) {
    usage();
    process.exit(0);
  }
  if (tier === "edit") {
    runEdit();
    process.exit(0);
  }
  const selection = select();
  if (selection.error) {
    console.error(selection.error);
    process.exit(2);
  }
  if (dry) {
    dryRun(selection.selected);
    process.exit(0);
  }
  const ready = preflight(selection.selected);
  if (ready.problems.length) {
    for (const problem of ready.problems) console.error(`Problem: ${problem}`);
    console.error("Nothing ran. Fix the problems above and rerun.");
    process.exit(1);
  }
  printPreflight(selection.selected, ready);
  if (check) process.exit(0);

  const output = join(".work", "tmp", `bench-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    tier,
    host: ready.host,
    timingValidity: ready.host === "quiet" ? "quiet host" : "busy host: ratios only",
    comparator: selection.selected.some((workload) => workload.tier === "scenario") ? comparator : null,
    workloads: [],
    exclusions: ["Full (manual only)", ...skips.map((name) => `skip ${name}`)],
  };
  let failed = false;
  for (const workload of selection.selected) {
    const started = Date.now();
    const result = workload.area === "onefile" ? runOnefile(workload, output) : await runNodeWorkload(workload, output);
    if (result.status !== 0) failed = true;
    const cpuPerWork = result.attributed?.cpuSeconds != null && result.samples.length
      ? result.attributed.cpuSeconds / result.samples.length
      : null;
    summary.workloads.push({
      name: workload.name,
      area: workload.area,
      tier: workload.tier,
      status: result.status === 0 ? "completed" : "failed",
      durationMs: Date.now() - started,
      samples: result.samples.length,
      cpuSecondsPerSample: cpuPerWork,
      output: join(output, `${workload.name}.json`),
    });
    console.log(`${workload.area}/${workload.name}: status=${result.status} samples=${result.samples.length} duration_ms=${Date.now() - started}`);
  }
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`Summary: ${join(output, "summary.json")}; completion is not a performance verdict.`);
  process.exit(failed ? 1 : 0);
}

main();
