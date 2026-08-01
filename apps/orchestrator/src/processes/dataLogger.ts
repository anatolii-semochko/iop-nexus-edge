// "data-logger" process kind (AGENTS.md's Data Logger section, built with
// Heartbeating Control as the explicit architectural template - confirmed
// with the user before building this). Every tick: for every Device with
// its own `periodSeconds` configured and `writeEnabled`, writes a fresh
// `log_device` row once that period has actually elapsed (via
// POST /devices/:id/log, which reads the device's own current live value
// server-side), then compares how many of the device's *own* periods have
// been skipped since the last successful write against its configured
// warning/error thresholds, raising WEM entries under *this* process's
// own id - same "watchdog reports under its own id, not the monitored
// entity's" convention as Heartbeating Control (`log_device`/
// `log_messages` has no FK for devices at all).
//
// Devices only, not Nodes (confirmed with the user) - a Device is atomic,
// exactly one value; a Node has none to log.
//
// Two global switches, read fresh every tick (an admin edit in Settings
// should take effect on the very next tick, not require a restart):
// - `errorWarningEnabled` gates whether overdue devices raise WEM at all -
//   logging itself is unaffected either way.
// - `tickLoggingEnabled` gates whether a device configured for
//   tick-resolution logging (`periodSeconds` at or below one tick) is
//   evaluated *at all* while off - deliberately a silent no-op, not a
//   warning, so a device left mis-configured this way doesn't itself
//   become a nagging alert; AGENTS.md documents why this exists (the
//   user recalled the old unconditional per-tick write producing
//   "thousands of records" before the Device/Node refactor removed it).

import { apiClient, type DataLoggerControlEntry, type DataLoggerSettings, type MessageInput, type ProcessRecord } from "../apiClient.js";
import { TICK_INTERVAL_MS } from "../tickInterval.js";

const TICK_SECONDS = TICK_INTERVAL_MS / 1000;

function skippedPeriods(lastLoggedAt: string | null, periodSeconds: number): number | null {
  if (!lastLoggedAt) return null;
  const elapsedMs = Date.now() - new Date(lastLoggedAt).getTime();
  return Math.floor(elapsedMs / (periodSeconds * 1000));
}

async function maybeLog(entry: DataLoggerControlEntry, periodSeconds: number): Promise<string | null> {
  const elapsedMs = entry.lastLoggedAt ? Date.now() - new Date(entry.lastLoggedAt).getTime() : null;
  const due = elapsedMs === null || elapsedMs >= periodSeconds * 1000;
  if (!due) return entry.lastLoggedAt;

  try {
    await apiClient.logDeviceReading(entry.id);
    // Written "now" from the orchestrator's own clock rather than
    // re-fetching - the WEM check right after this call only needs
    // "did a write just happen", not EdgeX-precise timing.
    return new Date().toISOString();
  } catch {
    // Leave lastLoggedAt as-is - a device that keeps failing to log stays
    // overdue by its true last-success time, which the caller's
    // skippedPeriods check below will pick up.
    return entry.lastLoggedAt;
  }
}

export async function runDataLogger(process: ProcessRecord): Promise<void> {
  let settings: DataLoggerSettings;
  let entries: DataLoggerControlEntry[];
  try {
    [settings, entries] = await Promise.all([apiClient.getDataLoggerSettings(), apiClient.listDataLoggerControls()]);
  } catch {
    // Already logged once by index.ts's own tick() for this same failure -
    // nothing further to do this tick.
    return;
  }

  const errorEntries: MessageInput[] = [];
  const warningEntries: MessageInput[] = [];

  for (const entry of entries) {
    const { writeEnabled, periodSeconds, warning, error } = entry.dataLoggerControl;
    if (!writeEnabled || periodSeconds === null) continue;
    if (periodSeconds <= TICK_SECONDS && !settings.tickLoggingEnabled) continue;

    const lastLoggedAt = await maybeLog(entry, periodSeconds);

    if (!settings.errorWarningEnabled) continue;
    if (!warning && !error) continue;

    const skipped = skippedPeriods(lastLoggedAt, periodSeconds);
    if (skipped === null) continue;

    // Error takes precedence over warning, same mutual-exclusivity
    // convention as resourceMonitor.ts/heartbeatControl.ts - a device is
    // never reported as both at once.
    if (error && skipped >= error.numberSkippedPeriods) {
      errorEntries.push({
        code: `overdue_device_${entry.id}`,
        level: error.level,
        text: `Device '${entry.name}' log is ${skipped} period(s) overdue`,
      });
    } else if (warning && skipped >= warning.numberSkippedPeriods) {
      warningEntries.push({
        code: `overdue_device_${entry.id}`,
        level: warning.level,
        text: `Device '${entry.name}' log is ${skipped} period(s) overdue`,
      });
    }
  }

  // Same row-highlight convention as heartbeatControl.ts - the boolean
  // flags drive the table row's red/yellow background, independent of
  // (but alongside) the WEM entries above which drive the notification
  // list/Dashboard.
  await apiClient.setCritical(process.id, errorEntries.length > 0);
  await apiClient.setWarning(process.id, errorEntries.length === 0 && warningEntries.length > 0);

  await apiClient.syncMessages(process.id, "error", errorEntries);
  await apiClient.syncMessages(process.id, "warning", warningEntries);
}
