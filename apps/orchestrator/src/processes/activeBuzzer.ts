// "active-buzzer" process kind (AGENTS.md's Active Zummer section):
// actively drives the Active Zummer device's `Buzzer` output according to
// the fleet-wide alarm policy (apps/orchestrator/src/alarmPolicy.ts) - the
// platform's first sound-output process, others to follow later (some
// controllable, some not, per the user's own stated direction). Runs once
// per tick (1s, same as every other process kind) while "on"; while "off"
// it forces the buzzer silent, same on->off edge handling the
// temperature-control process plugin uses (moved to
// nexus-edge-smart-house, AGENTS_TO_DO.md 2026-07-29).
//
// The actual beep-pattern/burst-timer machinery moved to ../soundOutput.ts
// (AGENTS_TO_DO.md, 2026-08-02) once the Alarm Annunciator process became
// a second consumer of the exact same logic - this file now only computes
// *this* process's own alarm condition (fleet-wide critical/warning) and
// hands the resulting plan off.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { determineAlarmPlan } from "../alarmPolicy.js";
import { logger } from "../logger.js";
import { driveSoundOutput, silenceSoundOutput } from "../soundOutput.js";

const lastStatus = new Map<number, "on" | "off">();

export async function runActiveBuzzer(process: ProcessRecord): Promise<void> {
  if (process.device_id === null) {
    logger.warn({ processId: process.id }, "active-buzzer process has no device_id");
    return;
  }

  const status = process.status ?? "on";
  const previous = lastStatus.get(process.id);
  lastStatus.set(process.id, status);

  if (status === "off") {
    if (previous === "on") {
      silenceSoundOutput(process.id, process.device_id);
    }
    return;
  }

  let processes: ProcessRecord[];
  let messageLevels: Awaited<ReturnType<typeof apiClient.getMessageLevels>>;
  try {
    [processes, messageLevels] = await Promise.all([apiClient.listProcesses(), apiClient.getMessageLevels()]);
  } catch (err) {
    logger.warn({ err }, "active-buzzer: failed to read fleet state");
    return;
  }

  // Synthetic single-level-1 arrays, not each process's own `messages`
  // list - see alarmPolicy.ts's doc comment for why (hidden-message
  // safety). Every real producer today only ever raises level 1 anyway
  // (apps/api/src/processMessages.ts).
  const activeLevelsByType = {
    error: processes.some((p) => p.critical) ? [1] : [],
    warning: processes.some((p) => p.warning) ? [1] : [],
  };
  const plan = determineAlarmPlan(activeLevelsByType, messageLevels);
  await driveSoundOutput(process.id, process.device_id, plan);
}
