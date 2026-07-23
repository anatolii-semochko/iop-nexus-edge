// Thin EdgeX client: only the handful of core-metadata/core-command calls
// the Devices API needs today. Not a general-purpose EdgeX SDK.

import { config } from "./config.js";

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
    throw new Error(`core-metadata GET /device/all failed: ${res.status}`);
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
  value: string;
  valueType: string;
  units?: string;
  origin: number;
}

interface CoreCommandReadResponse {
  event: { readings: EdgeXReading[] };
}

/** Live value of one resource - used for the device detail view. */
export async function readResource(deviceName: string, resource: string): Promise<EdgeXReading> {
  const url = `${config.edgex.coreCommandUrl}/api/v3/device/name/${encodeURIComponent(deviceName)}/${encodeURIComponent(resource)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`core-command GET ${deviceName}/${resource} failed: ${res.status}`);
  }
  const body = (await res.json()) as CoreCommandReadResponse;
  const reading = body.event.readings.find((r) => r.resourceName === resource) ?? body.event.readings[0];
  if (!reading) {
    throw new Error(`core-command GET ${deviceName}/${resource} returned no reading`);
  }
  return reading;
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
    throw new Error(`core-command PUT ${deviceName}/${resource} failed: ${res.status} ${text}`);
  }
}
