import type { InstagramFailureKind } from "../../instagram-client-core/src/index.ts";
import type { ArchiveFs } from "./fs.ts";

const JOB_FILE = "job.json";

export interface ParkedJob {
  readonly reason: InstagramFailureKind;
  readonly message: string;
  readonly operation: string;
  readonly collection: string;
  readonly lastCompleted: string | null;
  readonly parkedAt: string;
}

export function jobPath(outRoot: string): string {
  return outRoot + "/" + JOB_FILE;
}

export function readJob(fs: ArchiveFs, outRoot: string): ParkedJob | null {
  const raw = fs.readText(jobPath(outRoot));
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The parked job at " + jobPath(outRoot) + " is unreadable.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The parked job at " + jobPath(outRoot) + " is unreadable.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record["reason"] !== "string" || typeof record["message"] !== "string"
      || typeof record["collection"] !== "string" || typeof record["parkedAt"] !== "string") {
    throw new Error("The parked job at " + jobPath(outRoot) + " is unreadable.");
  }
  return {
    reason: record["reason"] as InstagramFailureKind,
    message: record["message"],
    operation: typeof record["operation"] === "string" ? record["operation"] : "",
    collection: record["collection"],
    lastCompleted: typeof record["lastCompleted"] === "string" ? record["lastCompleted"] : null,
    parkedAt: record["parkedAt"],
  };
}

export function parkJob(fs: ArchiveFs, outRoot: string, job: ParkedJob): void {
  fs.writeAtomicText(jobPath(outRoot), JSON.stringify(job, null, 2) + "\n");
}

export function clearJob(fs: ArchiveFs, outRoot: string): void {
  fs.remove(jobPath(outRoot));
}

export function assertRunnable(fs: ArchiveFs, outRoot: string, resume: boolean): void {
  const job = readJob(fs, outRoot);
  if (job === null) return;
  if (!resume) {
    throw new Error("Instagram job parked at " + job.parkedAt + " because " + job.message
      + " No work was started. Pass --resume after resolving it deliberately.");
  }
}
