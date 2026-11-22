export interface ProgressReport {
  readonly phase: string;
  readonly done: number;
  readonly total: number | null;
  readonly note?: string | undefined;
}

export interface ProgressReporter {
  update(report: ProgressReport): void;
  finish(message?: string): void;
}

function duration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function createProgressReporter(
  stream: Pick<NodeJS.WritableStream, "write"> & { isTTY?: boolean } = process.stderr,
  minIntervalMs = 500,
): ProgressReporter {
  const startedAt = Date.now();
  let lastAt = 0;
  let lastLine = "";
  const interactive = stream.isTTY === true;

  return {
    update(report) {
      const now = Date.now();
      if (now - lastAt < minIntervalMs && report.done > 0 && report.total !== null) return;
      const elapsed = now - startedAt;
      const percent = report.total === null || report.total <= 0
        ? ""
        : ` ${String(Math.min(100, Math.round((report.done / report.total) * 100))).padStart(3)}%`;
      const eta = report.total === null || report.done === 0 || report.done > report.total
        ? ""
        : ` eta ${duration(Math.round((elapsed / report.done) * (report.total - report.done)))}`;
      const count = report.total === null ? String(report.done) : `${report.done}/${report.total}`;
      const line = `${report.phase} ${count}${percent} ${duration(elapsed)}${eta}${report.note ? ` · ${report.note}` : ""}`;
      if (line === lastLine) return;
      lastAt = now;
      lastLine = line;
      stream.write(interactive ? `\r${line.padEnd(90).slice(0, 90)}` : `${line}\n`);
    },
    finish(message) {
      const text = message ?? "done";
      stream.write(interactive ? `\r${text.padEnd(90).slice(0, 90)}\n` : `${text}\n`);
      lastLine = "";
    },
  };
}
