import { readFileSync } from "node:fs";

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function pairedVerdict(baseline, candidate, options = {}) {
  const minimumEffect = options.minimumEffect ?? 0.1;
  const minimumPairs = options.minimumPairs ?? 5;
  const cost = (sample) => Number.isFinite(sample.cpuSeconds) && sample.cpuSeconds > 0
    ? sample.cpuSeconds / Math.max(1, sample.work)
    : null;
  const pairs = [];
  for (let index = 0; index < Math.min(baseline.length, candidate.length); index += 1) {
    const before = baseline[index];
    const after = candidate[index];
    if (!before || !after || before.work <= 0 || after.work <= 0) continue;
    const beforeCost = cost(before);
    const afterCost = cost(after);
    if (beforeCost === null || afterCost === null) continue;
    pairs.push(afterCost / beforeCost);
  }
  if (pairs.length < minimumPairs) {
    return { verdict: "inconclusive", reason: `only ${pairs.length} usable pairs`, pairs: pairs.length };
  }
  const ratio = median(pairs);
  const spread = Math.max(...pairs) - Math.min(...pairs);
  if (ratio === null) return { verdict: "inconclusive", reason: "no ratios", pairs: pairs.length };
  if (ratio > 1 + Math.max(minimumEffect, spread)) {
    return { verdict: "regression", ratio, spread, pairs: pairs.length };
  }
  return { verdict: "within", ratio, spread, pairs: pairs.length };
}

function readSamples(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : (parsed.samples ?? []);
}

export function budgetReport(baselinePath, candidatePath, options = {}) {
  const baseline = readSamples(baselinePath);
  const candidate = readSamples(candidatePath);
  const verdict = pairedVerdict(baseline, candidate, options);
  return { baseline: baselinePath, candidate: candidatePath, ...verdict };
}
