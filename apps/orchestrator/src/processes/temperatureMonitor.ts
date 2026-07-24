// "temperature-monitor" process kind (AGENTS.md section 10): a permanent,
// independent safety check on the same device a "temperature-control"
// process drives - deliberately configured with a *wider* min/max than the
// controller (a safety margin, not a duplicate of the same numbers) and a
// check the Model State Validator already enforces on the write path
// (Cooler and Heater never both active) as defense-in-depth: this catches
// it even if something bypassed that check (a stuck relay, a direct EdgeX
// write, a bug). Never reads/writes Postgres/Redis directly - only the
// Devices API, like every other process kind.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { logger } from "../logger.js";

export async function runTemperatureMonitor(process: ProcessRecord): Promise<void> {
  if (process.device_id === null) {
    logger.warn({ processId: process.id }, "temperature-monitor process has no device_id");
    return;
  }

  const { min, max, linkedProcessIds } = process.config;
  if (min === undefined || max === undefined || !linkedProcessIds?.length) {
    logger.warn({ processId: process.id }, "temperature-monitor process has no min/max/linkedProcessIds configured");
    return;
  }

  const device = await apiClient.getDevice(process.device_id);
  const temperature = Number(device.resources.Temperature?.value);
  const coolerActive = device.resources.Cooler?.value === true;
  const heaterActive = device.resources.Heater?.value === true;

  const outOfRange = Number.isFinite(temperature) && (temperature > max || temperature < min);
  const bothActive = coolerActive && heaterActive;
  const critical = outOfRange || bothActive;

  await Promise.all(linkedProcessIds.map((id) => apiClient.setCritical(id, critical)));
}
