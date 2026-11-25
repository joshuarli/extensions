import { writeJsonFile } from "../../src/state.ts";

const [path, writer, rounds] = process.argv.slice(2);
if (!path || !writer || !rounds) throw new Error("path, writer and rounds are required");

for (let round = 0; round < Number(rounds); round++) {
  writeJsonFile(path, { writer, round, blob: "x".repeat(200_000) });
}
