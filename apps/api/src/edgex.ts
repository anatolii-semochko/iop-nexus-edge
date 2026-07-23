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
 * devices list view, where per-resource live values would be overkill. */
export async function listEdgeXDevices(): Promise<EdgeXDeviceStatus[]> {
  const res = await fetch(`${config.edgex.coreMetadataUrl}/api/v3/device/all`);
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
  value: string | number;
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
// number. Parsing these into real JS numbers here, once, means every
// consumer (UI tables, the live WebSocket overlay, a future slider control)
// gets an actual number instead of having to re-parse an EdgeX-specific
// string format itself.
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
  if (!NUMERIC_VALUE_TYPES.has(reading.valueType) || typeof reading.value !== "string") {
    return reading;
  }
  return { ...reading, value: Number(reading.value) };
}

/** Live value of one resource - used for the device detail view. */
export async function readResource(deviceName: string, resource: string): Promise<EdgeXReading> {
  const url = `${config.edgex.coreCommandUrl}/api/v3/device/name/${encodeURIComponent(deviceName)}/${encodeURIComponent(resource)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new EdgeXError(`core-command GET ${deviceName}/${resource} failed: ${res.status}`, res.status);
  }
  const body = (await res.json()) as CoreCommandReadResponse;
  const reading = body.event.readings.find((r) => r.resourceName === resource) ?? body.event.readings[0];
  if (!reading) {
    throw new Error(`core-command GET ${deviceName}/${resource} returned no reading`);
  }
  return normalizeReading(reading);
}

/** Writes one resource - used by the dev simulator page to override a
 * virtual device's sensor values, and eventually by real actuator commands. */
export async function writeResource(deviceName: string, resource: string, value: unknown): Promise<void> {
  const url = `${config.edgex.coreCommandUrl}/api/v3/device/name/${encodeURIComponent(deviceName)}/${encodeURIComponent(resource)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [resource]: value }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `core-command PUT ${deviceName}/${resource} failed: ${res.status} ${text}`;
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
