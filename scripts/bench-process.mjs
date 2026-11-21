import { spawn, execFileSync } from "node:child_process";

function cpuSeconds(time) {
  const pieces = String(time).split(":").map((piece) => Number(piece));
  if (pieces.some((piece) => !Number.isFinite(piece))) return 0;
  let seconds = 0;
  for (const piece of pieces) seconds = seconds * 60 + piece;
  return seconds;
}

function psArguments() {
  return process.platform === "darwin"
    ? ["-axo", "pid=,ppid=,rss=,time=,command="]
    : ["-eo", "pid=,ppid=,rss=,time=,args="];
}

export function processTree(pid) {
  const output = execFileSync("ps", psArguments(), { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const rows = new Map();
  for (const line of output.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u);
    if (!match) continue;
    rows.set(Number(match[1]), {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKiB: Number(match[3]),
      cpu: cpuSeconds(match[4]),
    });
  }
  const stack = [pid];
  const seen = new Set();
  let cpu = 0;
  let rssKiB = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const row = rows.get(current);
    if (!row) continue;
    cpu += row.cpu;
    rssKiB += row.rssKiB;
    for (const [childPid, child] of rows) {
      if (child.ppid === current) stack.push(childPid);
    }
  }
  return { cpuSeconds: cpu, rssKiB };
}

export async function runAttributed(command, args, options = {}) {
  const started = performance.now();
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(options.env ?? {}) },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let peakRssKiB = 0;
  let cpuSeconds = 0;
  const sample = () => {
    try {
      const snapshot = processTree(child.pid ?? -1);
      peakRssKiB = Math.max(peakRssKiB, snapshot.rssKiB);
      cpuSeconds = Math.max(cpuSeconds, snapshot.cpuSeconds);
    } catch {
      return;
    }
  };
  const timer = setInterval(sample, 100);
  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
  clearInterval(timer);
  return {
    exitCode,
    wallMs: Math.round(performance.now() - started),
    cpuSeconds: Math.round(cpuSeconds * 100) / 100,
    peakRssKiB,
    stdout,
    stderr,
  };
}
