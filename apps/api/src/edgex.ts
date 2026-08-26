// Thin EdgeX client: only the handful of core-metadata/core-command calls
// the Devices API needs today. Not a general-purpose EdgeX SDK.

import { config } from "./config.js";

/**
 * An EdgeX call that returned a non-2xx response. Carries the *EdgeX*
 * status code (e.g. 405 for "this resource is read-only") so callers can
 * decide whether it reflects a bad request (4xx - forward as-is) or an
 * actual server-side failure (5xx), instead of every EdgeX rejection
 * surfacing as an opaque 500.
 */
export class EdgeXError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "EdgeXError";
  }
}

export interface EdgeXDeviceStatus {
  name: string;
  operatingState: string;
  adminState: string;
}

interface CoreMetadataDeviceListResponse {
  devices: Array<{ name: string; operatingState: string; adminState: string }>;
}

/** One core-metadata call, listing every device's status - used for the
 * devices list view, where per-resource live values would be overkill.
 * `limit=-1` disables core-metadata's own default page size (EdgeX
 * Foundry's own convention for "no limit" on list endpoints) - without
 * it this silently truncates to whatever that default is (empirically
 * 20 here) once the fleet grows past it, found live while seeding the
 * Alarm Annunciator's 17 devices (AGENTS_TO_DO.md, 2026-08-02): the
 * last few devices in core-metadata's own ordering (the buzzer plus two
 * LEDs) came back with `edgex: null` - not actually unprovisioned, just
 * cut off the page. */
export async function listEdgeXDevices(): Promise<EdgeXDeviceStatus[]> {
  const res = await fetch(`${config.edgex.coreMetadataUrl}/api/v3/device/all?limit=-1`);
  if (!res.ok) {
    throw new EdgeXError(`core-metadata GET /device/all failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as CoreMetadataDeviceListResponse;
  return body.devices.map((d) => ({
    name: d.name,
    operatingState: d.operatingState,
    adminState: d.adminState,
  }));
}

export interface EdgeXReading {
  resourceName: string;
  value: string | number | boolean;
  valueType: string;
  units?: string;
  origin: number;
}

interface CoreCommandReadResponse {
  event: { readings: EdgeXReading[] };
}

// EdgeX v2+ always encodes Float32/Float64 readings as scientific-notation
// strings ("2.15e+01") - there is no config knob to change this server-side
// (the old Writable.Reading.FloatEncoding option was removed after v1).
// Every integer/float valueType also comes back as a JSON string, not a
// number, and Bool comes back as the literal string "true"/"false", not a
// JSON boolean either. Parsing these into real JS values here, once, means
// every consumer (UI tables, the live WebSocket overlay, a future slider
// control) gets an actual number/boolean instead of having to re-parse an
// EdgeX-specific string format itself - a raw `reading.value === true`
// check would otherwise silently always be false for a device that's never
// been written through the Dual Devices Model yet (dualDevicesModel.ts's
// own cached `active` value round-trips through JSON.stringify of the
// original write, so it was never affected by this - only a fresh,
// never-written device's live EdgeX read was).
const NUMERIC_VALUE_TYPES = new Set([
  "Int8",
  "Int16",
  "Int32",
  "Int64",
  "Uint8",
  "Uint16",
  "Uint32",
  "Uint64",
  "Float32",
  "Float64",
]);

function normalizeReading(reading: EdgeXReading): EdgeXReading {
  if (typeof reading.value !== "string") {
    return reading;
  }
  if (NUMERIC_VALUE_TYPES.has(reading.valueType)) {
    return { ...reading, value: Number(reading.value) };
  }
  if (reading.valueType === "Bool") {
    return { ...reading, value: reading.value === "true" };
  }
  return reading;
}

/**
 * Live value of one Device - used for the device detail view. `commandName`
 * is `device.capabilities.edgexResource` (Postgres) - which EdgeX
 * deviceResource/command this atomic Device's single value is called under.
 * This is purely an internal EdgeX-protocol detail the caller resolves
 * before getting here, not a re-introduction of "resource" as something a
 * client addresses directly (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor -
 * every Device has exactly one value, there is no per-resource URL/state/
 * log dimension left anywhere above this module).
 */
export async function readValue(deviceName: string, commandName: string): Promise<EdgeXReading> {
  const url = `${config.edgex.coreCommandUrl}/api/v3/device/name/${encodeURIComponent(deviceName)}/${encodeURIComponent(commandName)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new EdgeXError(`core-command GET ${deviceName}/${commandName} failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as CoreCommandReadResponse;
  const reading = body.event.readings.find((r) => r.resourceName === commandName) ?? body.event.readings[0];
  if (!reading) {
    throw new Error(`core-command GET ${deviceName}/${commandName} returned no reading`);
  }
  return normalizeReading(reading);
}

/** Writes one Device's value - used by the dev simulator page to override a
 * virtual device's sensor values, and eventually by real actuator commands.
 * See readValue above for what `commandName` is. */
export async function writeValue(deviceName: string, commandName: string, value: unknown): Promise<void> {
  const url = `${config.edgex.coreCommandUrl}/api/v3/device/name/${encodeURIComponent(deviceName)}/${encodeURIComponent(commandName)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [commandName]: value }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `core-command PUT ${deviceName}/${commandName} failed: ${res.status} ${text}`;
    try {
      const body = JSON.parse(text) as { message?: string };
      if (body.message) {
        message = body.message;
      }
    } catch {
      // response wasn't JSON - keep the raw-text message above
    }
    throw new EdgeXError(message, res.status);
  }
}
