// "temperature-control" process kind (AGENTS.md section 10): actively
// drives Cooler/Heater on a device to keep its Temperature within
// [min, max]. Runs once per tick while the process is "on"; while "off" it
// does nothing further - except once, exactly on the on->off transition,
// where it forces both actuators off rather than leaving whichever one was
// last active running indefinitely with nothing watching it.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { logger } from "../logger.js";

// Last-known status per process id, purely to detect the on->off edge -
// in-memory only, resets cleanly on restart (same "config-time simplicity"
// as the rest of this codebase - nothing here needs to survive a restart,
// the next tick just re-evaluates from scratch).
const lastStatus = new Map<number, "on" | "off">();

export async function runTemperatureControl(process: ProcessRecord): Promise<void> {
  if (process.device_id === null) {
    logger.warn({ processId: process.id }, "temperature-control process has no device_id");
    return;
  }

  const status = process.status ?? "on";
  const previous = lastStatus.get(process.id);
  lastStatus.set(process.id, status);

  if (status === "off") {
    if (previous === "on") {
      await apiClient.setResourceAuto(process.device_id, "Cooler", false);
      await apiClient.setResourceAuto(process.device_id, "Heater", false);
    }
    return;
  }

  const { min, max } = process.config;
  if (min === undefined || max === undefined) {
    logger.warn({ processId: process.id }, "temperature-control process has no min/max configured");
    return;
  }

  const device = await apiClient.getDevice(process.device_id);
  const temperature = Number(device.resources.Temperature?.value);
  if (!Number.isFinite(temperature)) {
    logger.warn({ processId: process.id }, "temperature-control: no valid Temperature reading");
    return;
  }

  const cooling = temperature > max;
  const heating = temperature < min;
  await apiClient.setResourceAuto(process.device_id, "Cooler", cooling);
  await apiClient.setResourceAuto(process.device_id, "Heater", heating);
}
