// "active-buzzer" process kind (AGENTS.md's Active Zummer section):
// actively drives the Active Zummer device's `Buzzer` output according to
// the fleet-wide alarm policy (apps/orchestrator/src/alarmPolicy.ts) - the
// platform's first sound-output process, others to follow later (some
// controllable, some not, per the user's own stated direction). Runs once
// per tick (1s, same as every other process kind) while "on"; while "off"
// it forces the buzzer silent, same on->off edge handling as
// temperatureControl.ts.
//
// `constant` mode needs no timer at all - the buzzer is simply held true
// for as long as the condition (and this process) stays on. `shortBeep`/
// `longBeep` need sub-second on/off precision the shared 1s tick can't
// give on its own, so this module starts a private per-process interval
// (independent of the main RUNNERS loop in index.ts) that does the actual
// pulsing - the 1s tick's job is only to decide *whether* that private
// timer should be running, and with what period, not to drive it directly.

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { determineAlarmPlan } from "../alarmPolicy.js";
import { logger } from "../logger.js";

// How long the buzzer stays *on* within each repeat period for shortBeep/
// longBeep - the period itself (how often it repeats) is the admin's own
// `period_deciseconds` (Processes -> Settings -> Message Levels, already
// built); these two are fixed system constants for the tone's own
// duration, not per-level configurable (confirmed with the user - the
// per-level choice is *which* of these two patterns plays, via `mode`,
// not how long either one lasts).
const SHORT_BEEP_ON_DECISECONDS = 2; // 200ms chirp
const LONG_BEEP_ON_DECISECONDS = 8; // 800ms tone

const lastStatus = new Map<number, "on" | "off">();

interface BuzzerTimer {
  intervalHandle: ReturnType<typeof setInterval>;
  timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  mode: "shortBeep" | "longBeep";
  periodDeciseconds: number;
}
// Keyed by process id, not a single module-level timer - nothing stops a
// second buzzer-kind process existing later (a different device, e.g. a
// second sound output elsewhere), each needing its own independent pulse.
const timers = new Map<number, BuzzerTimer>();

function stopTimer(processId: number): void {
  const timer = timers.get(processId);
  if (!timer) return;
  clearInterval(timer.intervalHandle);
  if (timer.timeoutHandle) clearTimeout(timer.timeoutHandle);
  timers.delete(processId);
}

function writeBuzzer(deviceId: number, value: boolean): void {
  apiClient.setDeviceAuto(deviceId, value).catch((err) => {
    logger.warn({ err, deviceId, value }, "active-buzzer: failed to write Buzzer device");
  });
}

function startTimer(processId: number, deviceId: number, mode: "shortBeep" | "longBeep", periodDeciseconds: number): void {
  const onDeciseconds = mode === "shortBeep" ? SHORT_BEEP_ON_DECISECONDS : LONG_BEEP_ON_DECISECONDS;
  const periodMs = Math.max(periodDeciseconds, 1) * 100;
  // The tone can never outlast its own repeat period - a misconfigured
  // period shorter than the fixed on-duration just means "on the whole
  // time", not an overlapping/negative off-window.
  const onMs = Math.min(onDeciseconds * 100, periodMs);

  const pulse = () => {
    writeBuzzer(deviceId, true);
    const timeoutHandle = setTimeout(() => writeBuzzer(deviceId, false), onMs);
    const timer = timers.get(processId);
    if (timer) timer.timeoutHandle = timeoutHandle;
  };

  const intervalHandle = setInterval(pulse, periodMs);
  timers.set(processId, { intervalHandle, timeoutHandle: undefined, mode, periodDeciseconds });
  pulse(); // fire immediately - don't make a fresh alarm wait a full period for its first sound
}

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
      stopTimer(process.id);
      writeBuzzer(process.device_id, false);
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

  if (!plan) {
    stopTimer(process.id);
    writeBuzzer(process.device_id, false);
    return;
  }

  if (plan.mode === "constant") {
    // Handled without a tick, per spec - held on directly, no pulsing.
    stopTimer(process.id);
    writeBuzzer(process.device_id, true);
    return;
  }

  const existing = timers.get(process.id);
  const modeOrPeriodChanged =
    !existing || existing.mode !== plan.mode || existing.periodDeciseconds !== plan.periodDeciseconds;
  if (modeOrPeriodChanged) {
    stopTimer(process.id);
    startTimer(process.id, process.device_id, plan.mode, plan.periodDeciseconds);
  }
}
