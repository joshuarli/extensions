import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PARSER = "x-archive-core/src/parser.ts";
const STORE = "x-archive-cli/src/fs-store.ts";
const STATE = "x-archive-cli/src/state.ts";
const SCOPES = {
  parser: {
    files: {
      [PARSER]: [[226, 238], [291, 333], [384, 421]],
    },
    tests: ["extension-x-bookmarks/test/parser.test.ts", "extension-x-bookmarks/test/likes.test.ts", "extension-x-bookmarks/test/profile.test.ts"],
  },
  storage: {
    files: { [STORE]: [], [STATE]: [] },
    tests: ["x-archive-cli/test/fs-store.test.ts", "x-archive-cli/test/state.test.ts"],
  },
};

const EQUIVALENT = {
  [PARSER]: {
    digest: "f539ab3f792a0d3aa8c5554a4fbefe06d97bdeb162cf166c90462700747a307f",
    decisions: [[319, 14, "BlockStatement", "{}"]],
  },
  [STORE]: {
    digest: "f0cf89a9b0c99f695ef280704670a7e14ca4c986b4f819bb345c896c36b68642",
    decisions: [
      [23, 9, "ConditionalExpression", "true"],
      [23, 9, "LogicalOperator", 'error instanceof Error || "code" in error'],
    ],
  },
};

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function paths(base, plan) {
  const common = git("merge-base", "--", base, "HEAD").trim();
  const fields = git("diff", "--name-status", "--no-renames", "-z", common, ...(plan ? [] : ["HEAD"]), "--").split("\0");
  if (fields.pop() !== "" || fields.length % 2 !== 0) throw Error("malformed git diff");
  const changes = new Map();
  for (let index = 0; index < fields.length; index += 2) {
    const [status, path] = fields.slice(index, index + 2);
    if (!["A", "M", "D"].includes(status) || !path) throw Error(`unsupported git path change: ${status} ${path}`);
    changes.set(path, status);
  }
  if (plan) {
    for (const path of git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean)) {
      changes.set(path, "A");
    }
  }
  return changes;
}

function selection(changes) {
  const classes = {};
  const source = new Set();
  let protect = false;
  for (const [path, status] of changes) {
    if (/^(docs\/.*|AGENTS|README|TODO|TODO-DESLOP)\.md$/.test(path)) {
      classes[path] = "documentation";
    } else if (/(^|\/)(test|tests)\//.test(path) || path.endsWith(".test.ts")) {
      classes[path] = "test or fixture";
      protect = true;
    } else if (/^(\.github\/|\.gitignore$|Makefile$|package\.json$|pnpm-lock\.yaml$|\..*rc\.json$|[^/]+\.config\.ts$|tsconfig\.json$|scripts\/mutants-diff\.mjs$)/.test(path)) {
      classes[path] = "configuration";
      protect = true;
    } else if (/\.(ts|mjs)$/.test(path)) {
      classes[path] = status === "D" ? "deleted production" : "production";
      if (status === "D") throw Error(`no calibrated mutation witness for deleted production: ${path}`);
      source.add(path);
    } else {
      throw Error(`unclassified path: ${path}`);
    }
  }

  for (const path of source) {
    if (!Object.values(SCOPES).some(({ files }) => Object.hasOwn(files, path))) {
      throw Error(`no calibrated mutation witness for changed file: ${path}`);
    }
  }

  const jobs = {};
  for (const [name, { files, tests }] of Object.entries(SCOPES)) {
    const chosen = {};
    for (const [file, ranges] of Object.entries(files)) {
      if (source.has(file)) chosen[file] = [];
      else if (protect) chosen[file] = ranges;
    }
    if (Object.keys(chosen).length) jobs[name] = { files: chosen, tests };
  }
  return { classes, jobs };
}

function equivalent(path, source, mutant) {
  const record = EQUIVALENT[path];
  if (!record || createHash("sha256").update(source).digest("hex") !== record.digest) return false;
  const { line, column } = mutant.location.start;
  return record.decisions.some(([expectedLine, expectedColumn, name, replacement]) =>
    line === expectedLine && column === expectedColumn && mutant.mutatorName === name && mutant.replacement === replacement);
}

function checkReport(reportPath, expected) {
  const { files } = JSON.parse(readFileSync(reportPath, "utf8"));
  if (!files || Object.keys(files).sort().join("\n") !== Object.keys(expected).sort().join("\n")) {
    throw Error("mutation report does not cover exactly the selected files");
  }
  let passed = true;
  for (const [path, { source, mutants }] of Object.entries(files)) {
    if (source !== readFileSync(path, "utf8") || !Array.isArray(mutants) || !mutants.length) {
      throw Error(`wrong source or empty result for ${path}`);
    }
    const ids = new Set();
    const lines = new Set();
    for (const mutant of mutants) {
      if (typeof mutant.id !== "string" || ids.has(mutant.id) || !mutant.status) {
        throw Error(`missing or duplicate result for ${path}`);
      }
      ids.add(mutant.id);
      lines.add(mutant.location.start.line);
      const outcome = mutant.status === "Survived" && equivalent(path, source, mutant) ? "Equivalent" : mutant.status;
      console.log(`${path}:${mutant.location.start.line}:${mutant.location.start.column} ID ${mutant.id}: ${outcome} ${mutant.mutatorName}`);
      passed = (outcome === "Killed" || outcome === "Equivalent") && passed;
    }
    for (const [first, end] of expected[path]) {
      if (![...lines].some(line => line >= first && line < end)) {
        throw Error(`empty mutation range for ${path}:${first}-${end}`);
      }
    }
  }
  return passed;
}

function runShard(name, { files, tests }, toolRoot) {
  mkdirSync(".work/tmp", { recursive: true });
  const work = mkdtempSync(".work/tmp/mutants-diff-");
  try {
    const report = join(work, "results.json");
    const config = join(work, "stryker.json");
    writeFileSync(config, JSON.stringify({
      mutate: Object.entries(files).flatMap(([path, ranges]) =>
        ranges.length ? ranges.map(([first, end]) => `${path}:${first}:1-${end}:1`) : [path]),
      testRunner: "vitest",
      plugins: [join(toolRoot, "node_modules/@stryker-mutator/vitest-runner/dist/src/index.js")],
      vitest: { configFile: "vitest.config.ts", related: false },
      testFiles: tests,
      coverageAnalysis: "perTest",
      concurrency: 1,
      timeoutMS: 10000,
      timeoutFactor: 1.5,
      reporters: ["clear-text", "json"],
      jsonReporter: { fileName: report },
      tempDirName: join(work, "sandbox"),
    }));
    console.log(`Running ${name}`);
    const runner = join(toolRoot, "node_modules/@stryker-mutator/core/bin/stryker.js");
    const result = spawnSync("timeout", ["--kill-after=5", "600", process.execPath, runner, "run", config], {
      stdio: "inherit",
      env: { ...process.env, TMPDIR: resolve(".work/tmp") },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error(`mutation runner failed for ${name} (${result.status ?? result.signal})`);
    return checkReport(report, files);
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
}

function main([base, option, extra]) {
  const plan = option === "--plan";
  const shard = option?.startsWith("--shard=") ? option.slice("--shard=".length) : undefined;
  if (!base || extra || (option && !plan && (!shard || !Object.hasOwn(SCOPES, shard)))) {
    throw Error("usage: node scripts/mutants-diff.mjs BASE [--plan | --shard=parser | --shard=storage]");
  }
  if (!plan && git("status", "--porcelain", "--untracked-files=normal")) {
    throw Error("commit changes before running the mutation gate");
  }
  const { classes, jobs } = selection(paths(base, plan));
  console.log(JSON.stringify({ classes, jobs }, null, 2));
  if (!Object.keys(jobs).length) {
    console.log("no relevant changes");
    return;
  }
  if (plan) return;
  if (shard && !jobs[shard]) {
    console.log(`no mutations selected for shard ${shard}`);
    return;
  }

  const toolRoot = resolve(process.env.STRYKER_TOOL_ROOT ?? ".work/tmp/stryker-tools");
  for (const name of ["core", "vitest-runner"]) {
    const { version } = JSON.parse(readFileSync(join(toolRoot, `node_modules/@stryker-mutator/${name}/package.json`), "utf8"));
    if (version !== "10.1.1") throw Error(`Stryker ${name} 10.1.1 is required`);
  }
  let passed = true;
  for (const [name, job] of Object.entries(jobs)) {
    if (!shard || shard === name) passed = runShard(name, job, toolRoot) && passed;
  }
  if (!passed) throw Error("mutation gate found a miss or unqualified result");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
