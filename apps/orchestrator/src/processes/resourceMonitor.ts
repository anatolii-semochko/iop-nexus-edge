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
//
// Temperature (readTempCelsius) reads /sys/class/thermal directly, same
// dependency-free approach - no `systeminformation`, no `vcgencmd` shellout.
// On Raspberry Pi OS, the SoC temperature is exposed by the kernel's own
// bcm2835_thermal driver as thermal_zone0, no extra tooling needed. Requires
// the container to actually see host sysfs (default Docker behavior, not a
// bind mount this project adds) - if /sys/class/thermal isn't there or
// isn't readable, readTempCelsius returns undefined and every temp-related
// check/message below is skipped for that tick, the same way a first-tick
// missing CPU sample is skipped.

import * as fs from "node:fs";
import * as os from "node:os";

import { apiClient, type MessageInput, type ProcessRecord } from "../apiClient.js";

// os.cpus() reports cumulative tick counts since boot, not a point-in-time
// load - CPU% needs the delta between two samples, kept in module scope
// (in-memory only, resets cleanly on restart; nothing here needs to
// survive one) - same pattern the temperature-control process plugin
// uses for its own on->off edge tracking (nexus-edge-smart-house,
// AGENTS_TO_DO.md 2026-07-29).
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

const THERMAL_ZONES_DIR = "/sys/class/thermal";

// Highest reading across every zone, not just zone0 - on a Raspberry Pi
// there's normally only one (the SoC), but on an x86 dev machine there can
// be several (acpitz, x86_pkg_temp, nvme, wifi, ...) with no single
// well-known "the CPU" index. Reporting the hottest one keeps this a single
// number like the other three metrics, and matches the existing critical/
// warning model's own framing ("is anything on this host over threshold"),
// not per-sensor alerting.
function readTempCelsius(): number | undefined {
  let zones: string[];
  try {
    zones = fs.readdirSync(THERMAL_ZONES_DIR).filter((name) => name.startsWith("thermal_zone"));
  } catch {
    return undefined;
  }

  let max: number | undefined;
  for (const zone of zones) {
    try {
      const milliCelsius = Number.parseInt(fs.readFileSync(`${THERMAL_ZONES_DIR}/${zone}/temp`, "utf8"), 10);
      if (Number.isNaN(milliCelsius)) continue;
      const celsius = milliCelsius / 1000;
      if (max === undefined || celsius > max) max = celsius;
    } catch {
      // One zone failing to read (transient sensor glitch, permissions)
      // shouldn't drop the whole reading - skip it, keep the rest.
    }
  }
  return max;
}

// A threshold of 0 (or simply unset) means "don't check this metric" - per
// metric, independently, not an all-or-nothing gate on the whole tick like
// temperature-monitor's min/max. `undefined` and `0` are deliberately
// treated the same here.
function exceeds(value: number, threshold: number | undefined): boolean {
  return threshold !== undefined && threshold !== 0 && value > threshold;
}

const METRICS = [
  { key: "cpu", label: "CPU", unit: "%" },
  { key: "ram", label: "RAM", unit: "%" },
  { key: "disk", label: "Disk", unit: "%" },
  { key: "temp", label: "Temp", unit: "°C" },
] as const;

export async function runResourceMonitor(process: ProcessRecord): Promise<void> {
  const { cpuMax, ramMax, diskMax, tempMax, cpuWarnMax, ramWarnMax, diskWarnMax, tempWarnMax } = process.config;

  const cpu = readCpuPercent();
  const ram = readRamPercent();
  const disk = readDiskPercent();
  const temp = readTempCelsius();

  // First tick after a restart has no previous CPU sample yet - report a
  // safe reading and skip the critical/warning check just this once, rather
  // than flagging off the back of a misleading 0%.
  if (cpu === undefined) {
    await apiClient.setMetrics(process.id, { cpu: 0, ram, disk, temp });
    return;
  }

  await apiClient.setMetrics(process.id, { cpu, ram, disk, temp });

  // `temp` omitted from `values` (rather than defaulted to e.g. 0) when no
  // thermal zone was readable - the METRICS loop below skips any key absent
  // here, same as it would for a metric with no matching entry.
  const values: Partial<Record<(typeof METRICS)[number]["key"], number>> = { cpu, ram, disk };
  if (temp !== undefined) values.temp = temp;
  const maxByKey = { cpu: cpuMax, ram: ramMax, disk: diskMax, temp: tempMax };
  const warnMaxByKey = { cpu: cpuWarnMax, ram: ramWarnMax, disk: diskWarnMax, temp: tempWarnMax };

  const critical =
    exceeds(cpu, cpuMax) ||
    exceeds(ram, ramMax) ||
    exceeds(disk, diskMax) ||
    (temp !== undefined && exceeds(temp, tempMax));
  // Only reported once it's not already critical - error takes precedence
  // over warning (a red row, not a yellow one, once past the error max).
  const warning =
    !critical &&
    (exceeds(cpu, cpuWarnMax) ||
      exceeds(ram, ramWarnMax) ||
      exceeds(disk, diskWarnMax) ||
      (temp !== undefined && exceeds(temp, tempWarnMax)));

  await apiClient.setCritical(process.id, critical);
  await apiClient.setWarning(process.id, warning);

  // WEM (AGENTS.md section 22) - per metric, not per overall critical/
  // warning flag above, so e.g. CPU and RAM can each show their own
  // message if both happen to be over threshold at once. `level` is a
  // placeholder 1 for every entry - there's no Messages Configuration
  // page yet (deferred) to give the 1-4 level scale real meaning.
  const errorEntries: MessageInput[] = [];
  const warningEntries: MessageInput[] = [];
  for (const { key, label, unit } of METRICS) {
    const value = values[key];
    if (value === undefined) continue;
    if (exceeds(value, maxByKey[key])) {
      errorEntries.push({
        code: `${key}_error`,
        level: 1,
        text: `${label} at ${value.toFixed(1)}${unit} exceeds error threshold ${maxByKey[key]}${unit}`,
      });
    } else if (exceeds(value, warnMaxByKey[key])) {
      warningEntries.push({
        code: `${key}_warning`,
        level: 1,
        text: `${label} at ${value.toFixed(1)}${unit} exceeds warning threshold ${warnMaxByKey[key]}${unit}`,
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
