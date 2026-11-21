import { writeFileSync } from "node:fs";

const [name, output, samplesArg] = process.argv.slice(2);
if (!name || !output) {
  console.error("usage: node scripts/bench-workload.mjs NAME RESULT.json [SAMPLES]");
  process.exit(2);
}
const module = await import(`./workloads/${name}.mjs`);
const result = await module.run({ samples: Number(samplesArg ?? 5) });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
