// Thin Devices API client - the orchestrator's only way of reaching
// Postgres/Redis/EdgeX-backed state (AGENTS.md section 4/10). Not a general
// SDK, just the handful of calls the process tick loop needs.

import { config } from "./config.js";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // AGENTS_TO_DO.md, 2026-08-29 - server.ts's own tick() re-entrancy guard
  // (added the same day, to stop unbounded overlapping ticks) means a
  // fetch() that never settles now freezes every future tick permanently
  // instead of just adding to a pile - previously a real risk, since
  // nothing here had a timeout at all. AbortSignal.timeout() is the
  // built-in fetch mechanism for this, no extra dependency.
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: options.body ? { "Content-Type": "application/json" } : {},
    signal: AbortSignal.timeout(config.apiRequestTimeoutMs),
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Devices API ${options.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

// Minimal - only what apps/orchestrator's own process runners need
// (heartbeatControl.ts's fleet-wide staleness check, controlNode.ts's own
// pulse/heartbeat/sensor handling), not a full mirror of routes/nodes.ts's
// response shape.
export interface NodeRecord {
  id: number;
  name: string;
  heartbeat_control: HeartbeatControlConfig;
  heartbeatStopped: boolean;
  heartbeatLastSeenAt: string | null;
  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - while
  // true, this node has no real hardware link to expect a heartbeat
  // from at all (its own physical side is simply not currently in the
  // loop), so heartbeatControl.ts's own staleness check skips it
  // entirely rather than raising a permanent, un-actionable "hasn't
  // sent a heartbeat" alarm for a node that was deliberately put into
  // simulated/bench-test mode.
  simulated: boolean;
  // AGENTS.md section 61 - the same request-time staleness result this
  // file's own evaluate() below recomputes independently for WEM/critical/
  // warning purposes; read here too so the live-push diff (heartbeatControl.ts)
  // doesn't need a third computation of the same thing.
  heartbeatStale: "ok" | "warning" | "error";
}

export interface AnnunciatorSlot {
  redDeviceId: number;
  yellowDeviceId: number;
  messageGroupId: number | null;
}

export interface ProcessRecord {
  id: number;
  name: string;
  type: "controllable" | "permanent";
  kind: string;
  device_id: number | null;
  config: {
    min?: number;
    max?: number;
    // resource-monitor thresholds (AGENTS.md section 21), percentages. 0 or
    // undefined means "don't check this metric".
    cpuMax?: number;
    ramMax?: number;
    diskMax?: number;
    // Celsius, not a percentage like the three above - read from
    // /sys/class/thermal (resourceMonitor.ts). Absent when no thermal zone
    // is readable, e.g. a dev machine without container access to host
    // sysfs - same "0/undefined disables the check" rule still applies.
    tempMax?: number;
    cpuWarnMax?: number;
    ramWarnMax?: number;
    diskWarnMax?: number;
    tempWarnMax?: number;
    // temperature-control/temperature-monitor role -> deviceId mapping
    // (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor, roadmap Phase 4.1) - a
    // single `device_id` above no longer says enough once the sensor and
    // its two actuators are three separate atomic Devices, not one bundled
    // one with three named resources.
    sensorDeviceId?: number;
    heaterDeviceId?: number;
    coolerDeviceId?: number;
    // alarm-annunciator (AGENTS_TO_DO.md, 2026-08-02) - see
    // apps/api/src/routes/processes.ts's own ProcessConfig for the
    // authoritative shape this mirrors.
    slots?: AnnunciatorSlot[];
    testLevel?: { type: "warning" | "error"; level: number } | null;
    testSlotIndex?: number | null;
    // "control-node" kind (AGENTS_TO_DO.md, 2026-08-09 "НОДА КОНТРОЛЮ") -
    // device/node id mapping (same "loose jsonb, looked up by role" style
    // as sensorDeviceId/heaterDeviceId/coolerDeviceId above) plus its own
    // two-sided min/max/warnMin/warnMax thresholds for temperature and
    // humidity. `env` prefix (not `temp*`/`humidity*` plain) - resource-
    // monitor's own `tempMax`/`tempWarnMax` above are a different, ceiling-
    // only Celsius concept (host SoC temp), this is a two-sided enclosure
    // ambient range; the plain names would collide as duplicate object
    // keys on this same `config` type. `humidityDeviceId` is
    // nullable/absent - a DS18B20-only bring-up instance has no humidity
    // reading at all (see nexus-edge-aquarium's plugins/control-node/
    // process.ts), not a 0% reading.
    nodeId?: number;
    pulseDeviceId?: number;
    heartbeatDeviceId?: number;
    temperatureDeviceId?: number;
    humidityDeviceId?: number | null;
    envTempMin?: number;
    envTempMax?: number;
    envTempWarnMin?: number;
    envTempWarnMax?: number;
    envHumidityMin?: number;
    envHumidityMax?: number;
    envHumidityWarnMin?: number;
    envHumidityWarnMax?: number;
  };
  status?: "on" | "off";
  // Fleet-wide, unfiltered by any user's "hidden" dismissal (AGENTS.md's
  // Active Zummer section) - the active-buzzer process reads these across
  // every process to decide whether to sound, deliberately not the
  // `messages` field GET /processes also returns (that one excludes
  // hidden entries, which would let a dismissed notification silence a
  // still-active physical alarm).
  critical: boolean;
  warning: boolean;
  // Heartbeating Control (AGENTS.md) - `heartbeat_control` is this
  // process's own design-time config (Postgres); `heartbeatStopped`/
  // `heartbeatLastSeenAt` are its live Redis counterparts, both already
  // folded into this same GET /processes response so the heartbeat-control
  // process kind needs no separate call.
  heartbeat_control: HeartbeatControlConfig;
  heartbeatStopped: boolean;
  heartbeatLastSeenAt: string | null;
  // "heartbeat-control-test" kind only - its own internal simulate-
  // failure flag (Redis, set from its detail panel's switch, never the
  // generic ON/OFF status mechanism - AGENTS.md's Heartbeating Control
  // section explains why). Present on every process record regardless of
  // kind, same as heartbeatStopped above.
  heartbeatTestSimulateFailure: boolean;
}

// Mirrors apps/api's heartbeatControl.ts shape exactly (AGENTS.md's
// Heartbeating Control section) - no shared types package exists yet
// (AGENTS_TO_DO.md's refactoring notes, Etap 1/Phase 2) so this is hand-kept in
// sync, same known risk as every other cross-service DTO in this app.
export interface HeartbeatThreshold {
  numberSkippedTicks: number;
  level: number;
}

export interface HeartbeatControlConfig {
  stoppable: boolean;
  warning: HeartbeatThreshold | null;
  error: HeartbeatThreshold | null;
}

export interface ProcessMetrics {
  cpu: number;
  ram: number;
  disk: number;
  // Celsius. Absent when no thermal zone was readable (see
  // resourceMonitor.ts's readTempCelsius) - omitted from the payload
  // entirely rather than sent as 0, which would read as "freezing" instead
  // of "unknown".
  temp?: number;
}

export type MessageType = "warning" | "error" | "message";

export interface MessageInput {
  code: string;
  level: number;
  text: string;
}

// Mirrors processMessages.AutoResolveMode (apps/api) - see
// syncActiveMessages there for what each mode means.
export type AutoResolveMode = "always" | "when-hidden" | "never";

// A Device is atomic now (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor) -
// exactly one value, not a map of named resources.
export interface DeviceRecord {
  id: number;
  value: unknown;
}

// Mirrors apps/api's message_levels row shape (AGENTS.md's Active Zummer
// section, beep-count/repeat-seconds redesign AGENTS_TO_DO.md 2026-08-01) -
// see apps/orchestrator/src/alarmPolicy.ts for what consumes this.
export interface MessageLevelRecord {
  type: "warning" | "error";
  level: number;
  mode: "off" | "constant" | "shortBeep" | "longBeep";
  beep_count: number | null;
  repeat_seconds: number;
}

// Mirrors apps/api's message_signal_timing singleton row shape - the
// beep-pattern timing profile shared by every level/type, admin-editable
// in Settings -> Message Levels (right-hand form). See
// apps/orchestrator/src/processes/activeBuzzer.ts for what consumes this.
export interface MessageSignalTimingRecord {
  short_beep_seconds: number;
  short_beep_pause_seconds: number;
  long_beep_seconds: number;
  long_beep_pause_seconds: number;
}

// Mirrors apps/api's dataLoggerControl.ts shape exactly (AGENTS.md's Data
// Logger section) - same hand-kept-in-sync caveat as HeartbeatControlConfig
// above.
export interface DataLoggerThreshold {
  numberSkippedPeriods: number;
  level: number;
}

export interface DataLoggerControlConfig {
  writeEnabled: boolean;
  periodSeconds: number | null;
  warning: DataLoggerThreshold | null;
  error: DataLoggerThreshold | null;
}

export interface DataLoggerControlEntry {
  id: number;
  name: string;
  dataLoggerControl: DataLoggerControlConfig;
  lastLoggedAt: string | null;
}

export interface DataLoggerSettings {
  errorWarningEnabled: boolean;
  tickLoggingEnabled: boolean;
}

export const apiClient = {
  listProcesses: () => request<ProcessRecord[]>("/processes"),
  listNodes: () => request<NodeRecord[]>("/nodes"),
  getDevice: (deviceId: number) => request<DeviceRecord>(`/devices/${deviceId}`),
  // Node-side counterpart of the heartbeat call below - see routes/
  // nodes.ts's POST /nodes/heartbeat (AGENTS_TO_DO.md, 2026-08-09).
  touchNodeHeartbeats: (nodeIds: number[]) =>
    request(`/nodes/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ nodeIds }),
    }),
  // AGENTS.md's Active Zummer section - the admin-configured beep policy
  // per (type, level), read fresh every tick rather than cached, since an
  // admin edit in Settings -> Message Levels should take effect on the
  // very next tick, not require an orchestrator restart.
  getMessageLevels: () => request<MessageLevelRecord[]>("/message-levels"),
  // Same "read fresh every tick" convention as getMessageLevels above.
  getMessageSignalTiming: () => request<MessageSignalTimingRecord>("/message-signal-timing"),
  // Alarm Annunciator (AGENTS_TO_DO.md, 2026-08-02) - "does this group
  // currently have an active error/warning", read fresh every tick same
  // as message levels/signal timing above.
  getMessageGroupsActiveState: () =>
    request<{ id: number; hasActiveError: boolean; hasActiveWarning: boolean }[]>("/message-groups/active-state"),
  // Orchestrator-driven write - only reaches EdgeX while the device is
  // still AUTO (AGENTS.md section 6); always records the intended value
  // even while a human has it overridden MANUAL via the UI.
  setDeviceAuto: (deviceId: number, value: unknown) =>
    request(`/devices/${deviceId}/auto`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  // For a readOnly device with no EdgeX backend at all - e.g. the
  // `weather-control` process's own computed `light-level` device
  // (devices/standalone/sensor/light-level). setDeviceAuto above would
  // reject a readOnly device outright; this hits PUT /devices/:id/reading
  // instead (routes/devices.ts's own comment explains why neither
  // .../auto nor .../simulate fits).
  setDeviceReading: (deviceId: number, value: unknown) =>
    request(`/devices/${deviceId}/reading`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  setCritical: (processId: number, critical: boolean) =>
    request(`/processes/${processId}/critical`, {
      method: "POST",
      body: JSON.stringify({ critical }),
    }),
  setMetrics: (processId: number, metrics: ProcessMetrics) =>
    request(`/processes/${processId}/metrics`, {
      method: "POST",
      body: JSON.stringify(metrics),
    }),
  setWarning: (processId: number, warning: boolean) =>
    request(`/processes/${processId}/warning`, {
      method: "POST",
      body: JSON.stringify({ warning }),
    }),
  // WEM (AGENTS.md section 22) - `entries` must be the *complete current
  // set* of codes this process considers active for `type`, not just new
  // ones; the API reconciles that against what's already active (dedup,
  // resolve what's missing) - see processMessages.syncActiveMessages.
  // `autoResolve` defaults server-side to `"always"`/`"never"` (by type)
  // when omitted - only pass it explicitly for a `type: "message"` call
  // whose producer re-asserts its code every tick like a warning/error
  // would (see processMessages.syncActiveMessages's own doc comment for
  // what each mode does), not for a genuine one-shot notification.
  syncMessages: (processId: number, type: MessageType, entries: MessageInput[], autoResolve?: AutoResolveMode) =>
    request(`/processes/${processId}/messages`, {
      method: "POST",
      body: JSON.stringify({ type, entries, autoResolve }),
    }),
  // Forces an immediate fleet-wide public-state broadcast (AGENTS.md
  // section 24), outside the automatic critical/warning/new-message
  // triggers and the periodic timer - available for a process kind that
  // knows a change is time-sensitive in a way none of those cover. Not
  // called by any process kind today (nothing has needed it yet) - the
  // capability exists so a future one can reach for it without a new
  // endpoint. Always sends a body (even though `reason` is optional) -
  // `request()` above only sets Content-Type when a body is present, and a
  // bodyless POST with that header set is rejected by Fastify's JSON
  // parser (a real bug hit and fixed elsewhere in this codebase).
  forceStateBroadcast: (reason?: string) =>
    request("/processes/state/broadcast", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  // Node counterpart of forceStateBroadcast above (AGENTS.md section 61) -
  // called once per tick by heartbeat-control's own runner, only with the
  // ids whose heartbeatStale tier actually changed since the previous
  // tick (never the whole fleet - a node's own row is cheap to refetch
  // individually server-side, unlike the process snapshot's one assembled
  // blob).
  broadcastNodeState: (nodeIds: number[], reason?: string) =>
    request("/nodes/state/broadcast", {
      method: "POST",
      body: JSON.stringify({ nodeIds, reason }),
    }),
  // System tick pulse (AGENTS_TO_DO.md, 2026-08-01) - the header's green
  // "alive" indicator. No body at all (not even an empty one) - `request()`
  // above only sets Content-Type when a body is present, so this stays a
  // genuinely bodyless POST, the same problem forceStateBroadcast's comment
  // describes solved from the other direction (always sending a body there
  // instead of never sending one here).
  tick: () => request("/system/tick", { method: "POST" }),
  // Heartbeating Control (AGENTS.md) - one batched call per tick from
  // index.ts's tick(), not one per process; see
  // apps/api/src/heartbeatControl.ts's touchHeartbeats for what this
  // actually writes.
  touchHeartbeats: (processIds: number[]) =>
    request("/processes/heartbeat", {
      method: "POST",
      body: JSON.stringify({ processIds }),
    }),
  // Data Logger (AGENTS.md) - the combined Devices-only list + the
  // process's own two global switches; see apps/api/src/dataLoggerControl.ts.
  listDataLoggerControls: () => request<DataLoggerControlEntry[]>("/data-logger-controls"),
  getDataLoggerSettings: () => request<DataLoggerSettings>("/data-logger-controls/settings"),
  // Reads the device's own current live value server-side and writes it
  // to log_device in one call - see routes/devices.ts's POST
  // /devices/:id/log.
  logDeviceReading: (deviceId: number) =>
    request<{ status: string; value: unknown }>(`/devices/${deviceId}/log`, { method: "POST" }),
  // Generic escape hatch (AGENTS.md section 31) - a target project's own
  // process plugin (nexus-edge-aquarium's plugins/*/process.ts) can reach
  // its own private API routes (plugins/*/api.ts) this way, the same
  // `request()` every typed method above already uses, without needing
  // those routes added to this shared object.
  request: <T = unknown>(path: string, options?: RequestInit) => request<T>(path, options),
};
