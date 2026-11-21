import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function bench(...args: string[]) {
  return spawnSync(process.execPath, ["scripts/bench.mjs", ...args], { encoding: "utf8" });
}

describe("performance entrypoint", () => {
  it("lists every workload with its tier, area and purpose", () => {
    const result = bench("--list");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("onefile-cli\tonefile-assemble");
    expect(result.stdout).toContain("x-archive\tx-export");
    expect(result.stdout).toContain("single-file-core@1.7.1");
  });

  it("rejects Full, unknown names, unknown areas and unknown flags", () => {
    for (const args of [["--tier=full"], ["--workload=missing"], ["--area=missing"], ["--bogus"]]) {
      const result = bench(...args);
      expect(result.status, args.join(" ")).toBe(2);
    }
  });

  it("rejects a selection where every workload is skipped", () => {
    expect(bench("--workload=small", "--skip=small").status).toBe(2);
    expect(bench("--dry-run", "--skip=small").status).toBe(0);
  });

  it("dry run prints commands and writes nothing", () => {
    mkdirSync(join(".work", "tmp"), { recursive: true });
    const before = readdirSync(join(".work", "tmp")).sort();
    const result = bench("--dry-run", "--workload=x-export");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("node scripts/bench-workload.mjs x-export");
    expect(result.stdout).toContain("Full (manual only)");
    expect(readdirSync(join(".work", "tmp")).sort()).toEqual(before);
  });

  it("fails preflight before running when the pinned comparator is absent", () => {
    const directory = mkdtempSync(join(".work", "tmp", "bench-test-"));
    const file = join(directory, "comparator.json");
    writeFileSync(file, JSON.stringify({ name: "single-file-core", version: "1.7.1", path: ".work/tmp/does-not-exist" }));
    const result = spawnSync(process.execPath, ["scripts/bench.mjs", "--tier=scenario", "--workload=upstream-compare", "--check"], {
      encoding: "utf8",
      env: { ...process.env, BENCH_COMPARATOR_FILE: file },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Nothing ran");
  });
});
