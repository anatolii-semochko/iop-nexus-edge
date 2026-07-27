// "temperature-monitor" process kind (AGENTS.md section 10): a permanent,
// independent safety check on the same Node's devices a "temperature-
// control" process drives - deliberately configured with a *wider*
// min/max than the controller (a safety margin, not a duplicate of the
// same numbers) and a check the Model State Validator already enforces on
// the write path (Cooler and Heater never both active) as defense-in-depth:
// this catches it even if something bypassed that check (a stuck relay, a
// direct EdgeX write, a bug). Never reads/writes Postgres/Redis directly -
// only the Devices API, like every other process kind.
//
// Sensor/Heater/Cooler are three separate atomic Devices on the same Node
// now (to-do.txt's 2026-07-27 Device/Node refactor) - `process.config`'s
// sensorDeviceId/heaterDeviceId/coolerDeviceId (migration ...033) is the
// role -> deviceId mapping this process needs, same as temperatureControl.ts.

import { apiClient, type MessageInput, type ProcessRecord } from "../apiClient.js";
import { logger } from "../logger.js";

export async function runTemperatureMonitor(process: ProcessRecord): Promise<void> {
  const { sensorDeviceId, heaterDeviceId, coolerDeviceId, min, max } = process.config;
  if (sensorDeviceId === undefined || heaterDeviceId === undefined || coolerDeviceId === undefined) {
    logger.warn({ processId: process.id }, "temperature-monitor process is missing sensorDeviceId/heaterDeviceId/coolerDeviceId");
    return;
  }
  if (min === undefined || max === undefined) {
    logger.warn({ processId: process.id }, "temperature-monitor process has no min/max configured");
    return;
  }

  const [sensor, heater, cooler] = await Promise.all([
    apiClient.getDevice(sensorDeviceId),
    apiClient.getDevice(heaterDeviceId),
    apiClient.getDevice(coolerDeviceId),
  ]);
  const temperature = Number(sensor.value);
  const coolerActive = cooler.value === true;
  const heaterActive = heater.value === true;

  const outOfRange = Number.isFinite(temperature) && (temperature > max || temperature < min);
  const bothActive = coolerActive && heaterActive;
  const critical = outOfRange || bothActive;

  // Only this process's own critical flag (AGENTS.md section 10/22) - no
  // longer propagated to the temperature-control process it watches via
  // config.linkedProcessIds. That cross-process propagation was a kludge
  // from before WEM existed to make a monitor's finding visible on the
  // controllable process's own row too; flagged by the user as debt that
  // didn't fit the intended architecture and removed here. A permanent
  // monitor's own failure no longer forces the process it watches into
  // critical as a side effect.
  await apiClient.setCritical(process.id, critical);

  // WEM (AGENTS.md section 22) - same two conditions as `critical` above,
  // as their own error entries so they actually show up in the UI's
  // message row, not just the boolean flag.
  const entries: MessageInput[] = [];
  if (outOfRange) {
    entries.push({
      code: "temperature_out_of_range",
      level: 1,
      text: `Temperature ${temperature.toFixed(1)}° is outside [${min}, ${max}]`,
    });
  }
  if (bothActive) {
    entries.push({ code: "cooler_heater_conflict", level: 1, text: "Cooler and Heater are both active at once" });
  }
  await apiClient.syncMessages(process.id, "error", entries);
}
