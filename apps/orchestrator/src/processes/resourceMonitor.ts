// "resource-monitor" process kind (AGENTS.md section 21): a permanent host
// health check, not tied to any EdgeX device - CPU/RAM checked every tick
// (1s), disk checked at most once a minute (statfsSync isn't expensive, but
// there's no reason to hit it every tick when disk usage barely moves).
// Raises the same `critical` flag as temperature-monitor when any reading
// exceeds its configured max%, reusing the existing concept rather than
// inventing a parallel one.
//
// Node built-ins only - no `systeminformation` or other dependency. CPU/RAM
// read from /proc reflect the real host values as long as the container has
// no cgroup cpu/mem limits set (docker-compose.yml doesn't set any on
// orchestrator); disk usage from the container's own root filesystem
// likewise tracks the host disk's real free space, since no storage quota
// is configured for it either - both assumptions hold for this project's
// single-host/Raspberry-Pi deployment target, not for an arbitrary
// resource-limited container.

import * as fs from "node:fs";
import * as os from "node:os";

import { apiClient, type ProcessRecord } from "../apiClient.js";

// os.cpus() reports cumulative tick counts since boot, not a point-in-time
// load - CPU% needs the delta between two samples, kept in module scope
// like temperatureControl's lastStatus map (in-memory only, resets cleanly
// on restart; nothing here needs to survive one).
let lastCpuSample: { idle: number; total: number } | undefined;

function readCpuPercent(): number | undefined {
  const cpus = os.cpus();
  const idle = cpus.reduce((sum, c) => sum + c.times.idle, 0);
  const total = cpus.reduce(
    (sum, c) => sum + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq,
    0,
  );

  const previous = lastCpuSample;
  lastCpuSample = { idle, total };
  if (!previous) return undefined;

  const idleDelta = idle - previous.idle;
  const totalDelta = total - previous.total;
  if (totalDelta <= 0) return undefined;
  return 100 - (idleDelta / totalDelta) * 100;
}

function readRamPercent(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return ((total - free) / total) * 100;
}

const DISK_CHECK_INTERVAL_MS = 60_000;
let lastDiskCheck = 0;
let lastDiskPercent = 0;

function readDiskPercent(): number {
  const now = Date.now();
  if (now - lastDiskCheck < DISK_CHECK_INTERVAL_MS) return lastDiskPercent;
  lastDiskCheck = now;

  const stats = fs.statfsSync("/");
  const used = stats.blocks - stats.bfree;
  // Same formula `df` itself uses for its Use% column - bavail (blocks
  // available to unprivileged processes) rather than bfree in the
  // denominator, which accounts for the filesystem's reserved margin.
  lastDiskPercent = (used / (used + stats.bavail)) * 100;
  return lastDiskPercent;
}

// A threshold of 0 (or simply unset) means "don't check this metric" - per
// metric, independently, not an all-or-nothing gate on the whole tick like
// temperature-monitor's min/max. `undefined` and `0` are deliberately
// treated the same here.
function exceeds(value: number, threshold: number | undefined): boolean {
  return threshold !== undefined && threshold !== 0 && value > threshold;
}

export async function runResourceMonitor(process: ProcessRecord): Promise<void> {
  const { cpuMax, ramMax, diskMax, cpuWarnMax, ramWarnMax, diskWarnMax } = process.config;

  const cpu = readCpuPercent();
  const ram = readRamPercent();
  const disk = readDiskPercent();

  // First tick after a restart has no previous CPU sample yet - report a
  // safe reading and skip the critical/warning check just this once, rather
  // than flagging off the back of a misleading 0%.
  if (cpu === undefined) {
    await apiClient.setMetrics(process.id, { cpu: 0, ram, disk });
    return;
  }

  await apiClient.setMetrics(process.id, { cpu, ram, disk });

  const critical = exceeds(cpu, cpuMax) || exceeds(ram, ramMax) || exceeds(disk, diskMax);
  // Only reported once it's not already critical - error takes precedence
  // over warning (a red row, not a yellow one, once past the error max).
  const warning = !critical && (exceeds(cpu, cpuWarnMax) || exceeds(ram, ramWarnMax) || exceeds(disk, diskWarnMax));

  await apiClient.setCritical(process.id, critical);
  await apiClient.setWarning(process.id, warning);
}
