import assert from "node:assert/strict";
import { test } from "vitest";
import { createRebuildQueue } from "./rebuild-queue.ts";

test("a failed rebuild is reported and a later rebuild still runs", async () => {
  const reportedFailures: unknown[] = [],
    completedRebuilds: string[] = [],
    enqueueRebuild = createRebuildQueue((error) => reportedFailures.push(error)),
    buildError = new Error("compile failed");

  await enqueueRebuild(async () => {
    throw buildError;
  });
  await enqueueRebuild(async () => {
    completedRebuilds.push("later build");
  });

  assert.deepEqual(reportedFailures, [buildError]);
  assert.deepEqual(completedRebuilds, ["later build"]);
});
