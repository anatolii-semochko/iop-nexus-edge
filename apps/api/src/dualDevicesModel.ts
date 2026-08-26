// Dual Devices Model (see AGENTS.md section 6): Devices API's own state
// machine and command gate sitting above EdgeX, used for every device
// regardless of whether it is currently backed by real hardware or the
// Virtual Node Runtime. Distinct from the Virtual Node Runtime itself,
// which lives in apps/device-service, below EdgeX.
//
// Per-device, not per (device, resource) (AGENTS_TO_DO.md's 2026-07-27
// Device/Node refactor) - a Device is atomic now, exactly one value, so
// the extra dimension this module used to key on is gone.

import { logger } from "./logger.js";
import { publishDeviceEvent } from "./messaging.js";
import { redis } from "./redis.js";

export type Mode = "AUTO" | "MANUAL";

export interface DeviceState {
  mode: Mode;
  valueAuto: unknown;
  valueManual: unknown;
  /** valueManual while MANUAL, valueAuto while AUTO - whichever is
   * currently supposed to be driving the device. */
  active: unknown;
}

function keysFor(deviceId: number) {
  const prefix = `dvm:${deviceId}`;
  return {
    mode: `${prefix}:mode`,
    valueAuto: `${prefix}:valueAuto`,
    valueManual: `${prefix}:valueManual`,
  };
}

function decode(raw: string | null): unknown {
  if (raw === null || raw === "") {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Defensive: a value should never get here except through encode()
    // below, but a read must never 500 over data that turns out to be
    // malformed (e.g. a past bug persisted `undefined` as an empty
    // string - see the write-side guard in routes/devices.ts).
    return undefined;
  }
}

function encode(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

/**
 * Publishes the device's current effective state onto the shared
 * `nexus.events` bus (see apps/messaging-gateway) and refreshes the
 * `state:{deviceId}` Redis cache the gateway serves as an initial snapshot
 * to new WebSocket clients. Deliberately a separate key from `dvm:*` above
 * rather than derived from it on read: `state:*` has no TTL (it is
 * last-known-value state, valid until the next write - not a heartbeat/
 * liveness signal; there is no heartbeat producer yet at all).
 * Best-effort - a cache/bus hiccup must never fail the device write path
 * this is called from.
 */
async function publishState(deviceId: number, state: DeviceState, source: string): Promise<void> {
  const timestamp = new Date().toISOString();
  try {
    await redis.set(
      `state:${deviceId}`,
      encode({
        value: state.active,
        mode: state.mode,
        valueAuto: state.valueAuto,
        valueManual: state.valueManual,
        updatedAt: timestamp,
        source,
      }),
    );
  } catch (err) {
    logger.warn({ err, deviceId }, "failed to refresh state cache");
  }

  await publishDeviceEvent({
    domain: "device",
    entityId: deviceId,
    value: state.active,
    mode: state.mode,
    valueAuto: state.valueAuto,
    valueManual: state.valueManual,
    timestamp,
    source,
  });
}

/**
 * Same as publishState above (cache refresh + nexus.events publish), for a
 * readOnly (sensor) device that has no Dual Devices Model state at all -
 * no `dvm:*` keys, no mode/valueAuto/valueManual, just the value itself.
 * Called from the .../simulate write path (routes/devices.ts), which is
 * the only way such a device's value ever changes today.
 *
 * Deliberately does NOT log to log_device anymore (AGENTS_TO_DO.md's 2026-07-27
 * Device/Node refactor, direct instruction) - the old unconditional
 * "log every tick" behavior is removed outright, not replaced, in this
 * refactor. A future configurable process (or several) will decide what/
 * when to log into log_device; deviceLog.ts's logReading()/listDeviceLogs()
 * both still exist (the table and its read API survive, serving whatever
 * history was already logged before this change), just nothing calls
 * logReading() from here anymore.
 */
export async function publishReading(deviceId: number, value: unknown, source: string): Promise<void> {
  const timestamp = new Date().toISOString();
  try {
    await redis.set(`state:${deviceId}`, encode({ value, updatedAt: timestamp, source }));
  } catch (err) {
    logger.warn({ err, deviceId }, "failed to refresh state cache");
  }

  await publishDeviceEvent({ domain: "device", entityId: deviceId, value, timestamp, source });
}

/**
 * Reads back what publishReading() above last wrote into the `state:*`
 * cache - the only way to get a value for a Device with no EdgeX/hardware
 * backend at all (e.g. `light-level`, AGENTS.md section 66), since
 * routes/devices.ts's GET /devices/:id otherwise only ever sources
 * `value` from a live EdgeX readValue() call, which requires a
 * resolvable EdgeX device name. Returns null if nothing has been
 * published yet (a fresh Device row, never written).
 */
export async function getReading(
  deviceId: number,
): Promise<{ value: unknown; updatedAt: string; source: string } | null> {
  const raw = await redis.get(`state:${deviceId}`);
  if (raw === null) return null;
  const decoded = decode(raw);
  if (typeof decoded !== "object" || decoded === null) return null;
  return decoded as { value: unknown; updatedAt: string; source: string };
}

export async function getState(deviceId: number): Promise<DeviceState> {
  const k = keysFor(deviceId);
  const [mode, rawAuto, rawManual] = await Promise.all([
    redis.get(k.mode),
    redis.get(k.valueAuto),
    redis.get(k.valueManual),
  ]);

  const resolvedMode: Mode = mode === "MANUAL" ? "MANUAL" : "AUTO";
  const valueAuto = decode(rawAuto);
  const valueManual = decode(rawManual);

  return {
    mode: resolvedMode,
    valueAuto,
    valueManual,
    active: resolvedMode === "MANUAL" ? valueManual : valueAuto,
  };
}

/** Orchestrator-driven. Always records valueAuto, but only becomes the
 * device's active value while it is currently in AUTO mode - a manual
 * override keeps controlling the device even while the orchestrator keeps
 * computing what it would set automatically, so that value can take over
 * immediately once the device is released back to AUTO. */
export async function setActive(deviceId: number, value: unknown): Promise<DeviceState> {
  await redis.set(keysFor(deviceId).valueAuto, encode(value));
  const state = await getState(deviceId);
  await publishState(deviceId, state, "api");
  return state;
}

/** UI-driven manual override. Always becomes the device's active value. */
export async function setManualActive(deviceId: number, value: unknown): Promise<DeviceState> {
  const k = keysFor(deviceId);
  await Promise.all([redis.set(k.valueManual, encode(value)), redis.set(k.mode, "MANUAL")]);
  const state = await getState(deviceId);
  await publishState(deviceId, state, "api");
  return state;
}

/** Releases a device back to automatic control - the orchestrator's last
 * computed valueAuto becomes the active value again. */
export async function release(deviceId: number): Promise<DeviceState> {
  await redis.set(keysFor(deviceId).mode, "AUTO");
  const state = await getState(deviceId);
  await publishState(deviceId, state, "api");
  return state;
}

/**
 * The device's current active value, for the Model State Validator to
 * check other devices on the same node against. If this device has never
 * gone through setActive/setManualActive, Redis has nothing recorded yet
 * (a fresh device) - fall back to reading it live (the caller decides how)
 * and cache it as the initial AUTO value, so later checks don't need to.
 */
export async function resolveActiveValue(deviceId: number, readLive: () => Promise<unknown>): Promise<unknown> {
  const state = await getState(deviceId);
  if (state.valueAuto !== undefined || state.valueManual !== undefined) {
    return state.active;
  }
  const live = await readLive();
  await setActive(deviceId, live);
  return live;
}

/**
 * System-wide aggregate: AUTO if none of `deviceIds` has been overridden,
 * MANUAL if every one has, SERVICE if it's a mix - matches the three
 * states in AGENTS.md section 6 (SERVICE is derived, not separately
 * stored). `deviceIds` must be the *full* set of controllable device ids
 * that exist (from Postgres) - a device with no Redis key at all is
 * implicitly AUTO (never overridden), and omitting it here would silently
 * drop it from the count instead of counting it as AUTO.
 */
export async function systemMode(deviceIds: number[]): Promise<Mode | "SERVICE"> {
  if (deviceIds.length === 0) {
    return "AUTO";
  }

  const modes = await Promise.all(
    deviceIds.map(async (deviceId) => {
      const raw = await redis.get(keysFor(deviceId).mode);
      return raw === "MANUAL" ? "MANUAL" : "AUTO";
    }),
  );

  const hasManual = modes.includes("MANUAL");
  const hasAuto = modes.includes("AUTO");

  if (hasManual && hasAuto) return "SERVICE";
  return hasManual ? "MANUAL" : "AUTO";
}
