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

// AGENTS.md section 62 - the Devices list's own overdue status (distinct
// from the write-cadence WEM check below - see routes/devices.ts's
// publishOverdueIfChanged) needs *some* periodic re-evaluation to converge
// live rather than freezing at whatever a browser tab's own one-time
// mount fetch last saw, now that DevicesList.jsx no longer polls each row
// itself. `writeEnabled` devices already get this for free from maybeLog's
// own read above; a `!writeEnabled` device (real test case:
// control-node-heartbeat, periodSeconds set but logging deliberately off)
// otherwise has nothing to re-read it at all - `listDataLoggerControls`
// already includes it (its own WHERE clause is `readOnly`-only, not
// `writeEnabled`), so this loop already sees it, it just never used to
// read it. Plain `GET /devices/:id` (apiClient.getDevice, already existed)
// is enough - that route's own publishOverdueIfChanged does the actual
// diff-and-publish, nothing here needs to know if anything changed.
// In-memory only (resets on restart, same stance as every other tick-diff
// map this session) - touching every device again right after a restart
// is harmless, not worth guarding against.
const lastTouchedAt = new Map<number, number>();

async function maybeTouch(deviceId: number, periodSeconds: number): Promise<void> {
  const last = lastTouchedAt.get(deviceId);
  const due = last === undefined || Date.now() - last >= periodSeconds * 1000;
  if (!due) return;
  lastTouchedAt.set(deviceId, Date.now());
  try {
    await apiClient.getDevice(deviceId);
  } catch {
    // Best-effort, same as maybeLog - a device that keeps failing to read
    // stays overdue by its true last-success time.
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
    if (periodSeconds === null) continue;

    if (!writeEnabled) {
      // No history write, no WEM (that alert is specifically "logging is
      // overdue", meaningless for a device that isn't being logged at
      // all) - just the live-push touch, see maybeTouch's own comment.
      // Deliberately NOT gated by `tickLoggingEnabled` below - that
      // switch exists to guard against *write* spam (`log_device` rows
      // piling up at tick resolution), which doesn't apply here at all -
      // maybeTouch never writes anything. Found live: control-node-
      // heartbeat's own `periodSeconds: 1` (matching its real 1s
      // firmware broadcast rate) was being silently skipped entirely by
      // this same guard, meant for a different concern.
      await maybeTouch(entry.id, periodSeconds);
      continue;
    }

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
