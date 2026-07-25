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

import { apiClient, type MessageInput, type ProcessRecord } from "../apiClient.js";

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

const METRICS = [
  { key: "cpu", label: "CPU" },
  { key: "ram", label: "RAM" },
  { key: "disk", label: "Disk" },
] as const;

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

  const values = { cpu, ram, disk };
  const maxByKey = { cpu: cpuMax, ram: ramMax, disk: diskMax };
  const warnMaxByKey = { cpu: cpuWarnMax, ram: ramWarnMax, disk: diskWarnMax };

  const critical = exceeds(cpu, cpuMax) || exceeds(ram, ramMax) || exceeds(disk, diskMax);
  // Only reported once it's not already critical - error takes precedence
  // over warning (a red row, not a yellow one, once past the error max).
  const warning = !critical && (exceeds(cpu, cpuWarnMax) || exceeds(ram, ramWarnMax) || exceeds(disk, diskWarnMax));

  await apiClient.setCritical(process.id, critical);
  await apiClient.setWarning(process.id, warning);

  // WEM (AGENTS.md section 22) - per metric, not per overall critical/
  // warning flag above, so e.g. CPU and RAM can each show their own
  // message if both happen to be over threshold at once. `level` is a
  // placeholder 1 for every entry - there's no Messages Configuration
  // page yet (deferred) to give the 1-4 level scale real meaning.
  const errorEntries: MessageInput[] = [];
  const warningEntries: MessageInput[] = [];
  for (const { key, label } of METRICS) {
    const value = values[key];
    if (exceeds(value, maxByKey[key])) {
      errorEntries.push({
        code: `${key}_error`,
        level: 1,
        text: `${label} at ${value.toFixed(1)}% exceeds error threshold ${maxByKey[key]}%`,
      });
    } else if (exceeds(value, warnMaxByKey[key])) {
      warningEntries.push({
        code: `${key}_warning`,
        level: 1,
        text: `${label} at ${value.toFixed(1)}% exceeds warning threshold ${warnMaxByKey[key]}%`,
      });
    }
  }
  await apiClient.syncMessages(process.id, "error", errorEntries);
  await apiClient.syncMessages(process.id, "warning", warningEntries);

  // Disk-only addition on top of the generic error/warning above: a
  // `message` notice (AGENTS.md section 22 - dismissible via the UI's X,
  // unlike the plain warning/error entries above it). CPU/RAM
  // deliberately don't get this - just the standard error/warning
  // entries above - this is Disk-specific by request, not a fourth
  // generic per-metric loop.
  //
  // `autoResolve: "when-hidden"` (unlike a true one-shot message) - this
  // producer re-evaluates and re-asserts the same code every tick for as
  // long as Disk stays over threshold, exactly like the warning/error
  // entries do, so a *dismissed* notice should still resolve once Disk
  // drops back down (letting a later re-trigger surface a fresh,
  // undismissed row instead of silently rewriting the still-hidden one in
  // place) - but a notice the user hasn't dismissed yet must stay visible
  // even after Disk drops back down, per rule 1 ("message: visible until
  // the user closes it"), which plain `"always"` would violate.
  const messageEntries: MessageInput[] = [];
  if (exceeds(disk, diskMax)) {
    messageEntries.push({
      code: "disk_error_notice",
      level: 1,
      text: `Disk at ${disk.toFixed(1)}% exceeds error threshold ${diskMax}%`,
    });
  } else if (exceeds(disk, diskWarnMax)) {
    messageEntries.push({
      code: "disk_warning_notice",
      level: 1,
      text: `Disk at ${disk.toFixed(1)}% exceeds warning threshold ${diskWarnMax}%`,
    });
  }
  await apiClient.syncMessages(process.id, "message", messageEntries, "when-hidden");
}
