// Dual Devices Model (see AGENTS.md section 6): Devices API's own state
// machine and command gate sitting above EdgeX, used for every device
// regardless of whether it is currently backed by real hardware or the
// Virtual Node Runtime. Distinct from the Virtual Node Runtime itself,
// which lives in apps/device-service, below EdgeX.
//
// Generalized here to per (device, resource) rather than strictly
// per-device, since that's the granularity the rest of this API (and the
// Model State Validator) already operates at - a single-purpose device
// (e.g. a valve) is just the case where a device happens to have one
// resource.

import { redis } from "./redis.js";

export type Mode = "AUTO" | "MANUAL";

export interface ResourceState {
  mode: Mode;
  valueAuto: unknown;
  valueManual: unknown;
  /** valueManual while MANUAL, valueAuto while AUTO - whichever is
   * currently supposed to be driving the device. */
  active: unknown;
}

function keysFor(deviceId: number, resource: string) {
  const prefix = `dvm:${deviceId}:${resource}`;
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

export async function getState(deviceId: number, resource: string): Promise<ResourceState> {
  const k = keysFor(deviceId, resource);
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
 * resource's active value while it is currently in AUTO mode - a manual
 * override keeps controlling the device even while the orchestrator keeps
 * computing what it would set automatically, so that value can take over
 * immediately once the resource is released back to AUTO. */
export async function setActive(deviceId: number, resource: string, value: unknown): Promise<ResourceState> {
  await redis.set(keysFor(deviceId, resource).valueAuto, encode(value));
  return getState(deviceId, resource);
}

/** UI-driven manual override. Always becomes the resource's active value. */
export async function setManualActive(deviceId: number, resource: string, value: unknown): Promise<ResourceState> {
  const k = keysFor(deviceId, resource);
  await Promise.all([redis.set(k.valueManual, encode(value)), redis.set(k.mode, "MANUAL")]);
  return getState(deviceId, resource);
}

/** Releases a resource back to automatic control - the orchestrator's last
 * computed valueAuto becomes the active value again. */
export async function release(deviceId: number, resource: string): Promise<ResourceState> {
  await redis.set(keysFor(deviceId, resource).mode, "AUTO");
  return getState(deviceId, resource);
}

/**
 * The resource's current active value, for the Model State Validator to
 * check other resources against. If this resource has never gone through
 * setActive/setManualActive, Redis has nothing recorded yet (a fresh
 * device) - fall back to reading it live (the caller decides how) and
 * cache it as the initial AUTO value, so later checks don't need to.
 */
export async function resolveActiveValue(
  deviceId: number,
  resource: string,
  readLive: () => Promise<unknown>,
): Promise<unknown> {
  const state = await getState(deviceId, resource);
  if (state.valueAuto !== undefined || state.valueManual !== undefined) {
    return state.active;
  }
  const live = await readLive();
  await setActive(deviceId, resource, live);
  return live;
}

/**
 * System-wide aggregate: AUTO if none of `resources` has been overridden,
 * MANUAL if every one has, SERVICE if it's a mix - matches the three
 * states in AGENTS.md section 6 (SERVICE is derived, not separately
 * stored). `resources` must be the *full* set of (deviceId, resource)
 * pairs that exist (from Postgres) - a resource with no Redis key at all
 * is implicitly AUTO (never overridden), and omitting it here would
 * silently drop it from the count instead of counting it as AUTO.
 */
export async function systemMode(resources: Array<{ deviceId: number; resource: string }>): Promise<Mode | "SERVICE"> {
  if (resources.length === 0) {
    return "AUTO";
  }

  const modes = await Promise.all(
    resources.map(async ({ deviceId, resource }) => {
      const raw = await redis.get(keysFor(deviceId, resource).mode);
      return raw === "MANUAL" ? "MANUAL" : "AUTO";
    }),
  );

  const hasManual = modes.includes("MANUAL");
  const hasAuto = modes.includes("AUTO");

  if (hasManual && hasAuto) return "SERVICE";
  return hasManual ? "MANUAL" : "AUTO";
}
