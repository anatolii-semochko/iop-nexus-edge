// "temperature-control" process kind (AGENTS.md section 10): actively
// drives Cooler/Heater on a Node's devices to keep its Temperature within
// [min, max]. Runs once per tick while the process is "on"; while "off" it
// does nothing further - except once, exactly on the on->off transition,
// where it forces both actuators off rather than leaving whichever one was
// last active running indefinitely with nothing watching it.
//
// Sensor/Heater/Cooler are three separate atomic Devices on the same Node
// now (to-do.txt's 2026-07-27 Device/Node refactor) - `process.config`'s
// sensorDeviceId/heaterDeviceId/coolerDeviceId (migration ...033) is the
// role -> deviceId mapping this process needs, since a single `device_id`
// no longer says enough on its own.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { logger } from "../logger.js";

// Last-known status per process id, purely to detect the on->off edge -
// in-memory only, resets cleanly on restart (same "config-time simplicity"
// as the rest of this codebase - nothing here needs to survive a restart,
// the next tick just re-evaluates from scratch).
const lastStatus = new Map<number, "on" | "off">();

export async function runTemperatureControl(process: ProcessRecord): Promise<void> {
  const { sensorDeviceId, heaterDeviceId, coolerDeviceId, min, max } = process.config;
  if (sensorDeviceId === undefined || heaterDeviceId === undefined || coolerDeviceId === undefined) {
    logger.warn({ processId: process.id }, "temperature-control process is missing sensorDeviceId/heaterDeviceId/coolerDeviceId");
    return;
  }

  const status = process.status ?? "on";
  const previous = lastStatus.get(process.id);
  lastStatus.set(process.id, status);

  if (status === "off") {
    if (previous === "on") {
      await apiClient.setDeviceAuto(coolerDeviceId, false);
      await apiClient.setDeviceAuto(heaterDeviceId, false);
    }
    return;
  }

  if (min === undefined || max === undefined) {
    logger.warn({ processId: process.id }, "temperature-control process has no min/max configured");
    return;
  }

  const sensor = await apiClient.getDevice(sensorDeviceId);
  const temperature = Number(sensor.value);
  if (!Number.isFinite(temperature)) {
    logger.warn({ processId: process.id }, "temperature-control: no valid Temperature reading");
    return;
  }

  const cooling = temperature > max;
  const heating = temperature < min;
  await apiClient.setDeviceAuto(coolerDeviceId, cooling);
  await apiClient.setDeviceAuto(heaterDeviceId, heating);
}
