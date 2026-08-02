// "alarm-annunciator" process kind (AGENTS_TO_DO.md, 2026-08-02): drives
// the Alarm Annunciator node's 16 LEDs (8 red/error, 8 yellow/warning -
// one pair per Message Group slot, bound via the process's own config,
// `PATCH /processes/:id/config`) plus its own buzzer. Runs once per tick
// (1s), same "off forces everything silent" edge handling as
// active-buzzer.
//
// Each slot's LEDs light up per Message Group independently - unlike the
// buzzer (one shared sound, highest active level wins via alarmPolicy.ts,
// same policy Active Zummer already uses), all active groups' LEDs stay
// lit simultaneously (confirmed with the user - severity level doesn't
// change the LED itself, only which groups currently have something
// active). A held test button (config.testSlotIndex/testLevel, written
// by the process panel on mousedown/mouseup - momentary, matches
// devices/standalone/input/button's own "active while held" definition)
// additionally drives that one slot at the operator-chosen level, so the
// buzzer's levels 2-4 (nothing else can trigger those yet - see
// alarmPolicy.ts's own "only level 1 is real today" note) are actually
// testable.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { determineAlarmPlan } from "../alarmPolicy.js";
import { logger } from "../logger.js";
import { driveSoundOutput, silenceSoundOutput } from "../soundOutput.js";

const lastStatus = new Map<number, "on" | "off">();

function writeLed(deviceId: number, value: boolean): void {
  apiClient.setDeviceAuto(deviceId, value).catch((err) => {
    logger.warn({ err, deviceId, value }, "alarm-annunciator: failed to write LED device");
  });
}

export async function runAlarmAnnunciator(process: ProcessRecord): Promise<void> {
  if (process.device_id === null) {
    logger.warn({ processId: process.id }, "alarm-annunciator process has no device_id");
    return;
  }

  const status = process.status ?? "on";
  const previous = lastStatus.get(process.id);
  lastStatus.set(process.id, status);
  const slots = process.config.slots ?? [];

  if (status === "off") {
    if (previous === "on") {
      silenceSoundOutput(process.id, process.device_id);
      for (const slot of slots) {
        writeLed(slot.redDeviceId, false);
        writeLed(slot.yellowDeviceId, false);
      }
    }
    return;
  }

  let activeState: Awaited<ReturnType<typeof apiClient.getMessageGroupsActiveState>>;
  let messageLevels: Awaited<ReturnType<typeof apiClient.getMessageLevels>>;
  try {
    [activeState, messageLevels] = await Promise.all([
      apiClient.getMessageGroupsActiveState(),
      apiClient.getMessageLevels(),
    ]);
  } catch (err) {
    logger.warn({ err }, "alarm-annunciator: failed to read fleet state");
    return;
  }
  const activeById = new Map(activeState.map((group) => [group.id, group]));

  const testLevel = process.config.testLevel ?? null;
  const testSlotIndex = process.config.testSlotIndex ?? null;

  let anyErrorActive = false;
  let anyWarningActive = false;

  slots.forEach((slot, index) => {
    const group = slot.messageGroupId !== null ? activeById.get(slot.messageGroupId) : undefined;
    const isTestedSlot = testSlotIndex === index && testLevel !== null;

    const errorActive = Boolean(group?.hasActiveError) || (isTestedSlot && testLevel?.type === "error");
    const warningActive = Boolean(group?.hasActiveWarning) || (isTestedSlot && testLevel?.type === "warning");

    writeLed(slot.redDeviceId, errorActive);
    writeLed(slot.yellowDeviceId, warningActive);

    if (errorActive) anyErrorActive = true;
    if (warningActive) anyWarningActive = true;
  });

  // Same "level 1 is the only thing a real producer emits today"
  // simplification active-buzzer already makes - a held test button
  // additionally contributes its own chosen level, which is the only
  // way to exercise levels 2-4 anywhere in the system right now.
  const errorLevels = anyErrorActive ? [1] : [];
  const warningLevels = anyWarningActive ? [1] : [];
  if (testSlotIndex !== null && testLevel?.type === "error") errorLevels.push(testLevel.level);
  if (testSlotIndex !== null && testLevel?.type === "warning") warningLevels.push(testLevel.level);

  const plan = determineAlarmPlan({ error: errorLevels, warning: warningLevels }, messageLevels);
  await driveSoundOutput(process.id, process.device_id, plan);
}
