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
// Beep-count/repeat-seconds redesign (AGENTS_TO_DO.md, 2026-08-01):
// `constant` mode still needs no timer at all - the buzzer is simply held
// true for as long as the condition (and this process) stays on.
// `shortBeep`/`longBeep` now play a *burst* of the admin's configured
// `beepCount` beeps (each on for `message_signal_timing`'s per-style
// on-duration, separated by that style's own pause) - sub-second
// precision the shared 1s tick can't give on its own, so this module
// schedules the burst itself via a private per-process `setTimeout` chain
// (independent of the main RUNNERS loop in index.ts). Once a burst
// finishes: if `repeatSeconds` > 0, the whole burst replays after that
// many seconds for as long as the condition stays active; if 0, it played
// once for this activation and stays silent until the condition clears
// and re-triggers (edge-triggered - confirmed with the user).

import { apiClient, type ProcessRecord } from "../apiClient.js";
import { determineAlarmPlan } from "../alarmPolicy.js";
import { logger } from "../logger.js";

const lastStatus = new Map<number, "on" | "off">();

interface BurstState {
  timeoutHandle: ReturnType<typeof setTimeout>;
  // What this burst chain is currently playing - compared against a fresh
  // tick's plan to decide whether to let it keep running (repeatSeconds >
  // 0, still mid-cycle) or start over.
  signature: string;
}
// Keyed by process id, not a single module-level timer - nothing stops a
// second buzzer-kind process existing later (a different device, e.g. a
// second sound output elsewhere), each needing its own independent burst.
const bursts = new Map<number, BurstState>();

// The signature of the last burst *started* for this process, kept even
// after a one-shot (repeatSeconds === 0) burst finishes playing - without
// this, a finished one-shot burst would look identical to "never started"
// on the next tick (its `bursts` entry is gone once done) and would
// incorrectly replay every tick for as long as the condition stays active.
const lastSignature = new Map<number, string>();

function stopBurst(processId: number): void {
  const burst = bursts.get(processId);
  if (!burst) return;
  clearTimeout(burst.timeoutHandle);
  bursts.delete(processId);
}

function writeBuzzer(deviceId: number, value: boolean): void {
  apiClient.setDeviceAuto(deviceId, value).catch((err) => {
    logger.warn({ err, deviceId, value }, "active-buzzer: failed to write Buzzer device");
  });
}

function planSignature(
  mode: "shortBeep" | "longBeep",
  beepCount: number,
  repeatSeconds: number,
  timing: Awaited<ReturnType<typeof apiClient.getMessageSignalTiming>>,
): string {
  return [
    mode,
    beepCount,
    repeatSeconds,
    timing.short_beep_seconds,
    timing.short_beep_pause_seconds,
    timing.long_beep_seconds,
    timing.long_beep_pause_seconds,
  ].join(":");
}

/**
 * Schedules a burst of `beepCount` beeps (on for `onSeconds`, off for
 * `pauseSeconds` between beeps, no trailing pause after the last one), then
 * either reschedules itself after `repeatSeconds` (> 0) or stops and leaves
 * `bursts` empty (=== 0 - `lastSignature` above is what remembers this
 * activation already played once).
 */
function playBurst(
  processId: number,
  deviceId: number,
  beepCount: number,
  onSeconds: number,
  pauseSeconds: number,
  repeatSeconds: number,
  signature: string,
): void {
  const schedule = (delayMs: number, fn: () => void): void => {
    const timeoutHandle = setTimeout(fn, Math.max(delayMs, 0));
    bursts.set(processId, { timeoutHandle, signature });
  };

  let beepsPlayed = 0;
  const playOneBeep = (): void => {
    writeBuzzer(deviceId, true);
    schedule(onSeconds * 1000, () => {
      writeBuzzer(deviceId, false);
      beepsPlayed += 1;
      if (beepsPlayed < beepCount) {
        schedule(pauseSeconds * 1000, playOneBeep);
      } else if (repeatSeconds > 0) {
        schedule(repeatSeconds * 1000, () => {
          beepsPlayed = 0;
          playOneBeep();
        });
      } else {
        bursts.delete(processId);
      }
    });
  };
  playOneBeep();
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
      stopBurst(process.id);
      lastSignature.delete(process.id);
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
    stopBurst(process.id);
    lastSignature.delete(process.id);
    writeBuzzer(process.device_id, false);
    return;
  }

  if (plan.mode === "constant") {
    // Handled without a tick, per spec - held on directly, no pulsing.
    stopBurst(process.id);
    lastSignature.delete(process.id);
    writeBuzzer(process.device_id, true);
    return;
  }

  let timing: Awaited<ReturnType<typeof apiClient.getMessageSignalTiming>>;
  try {
    timing = await apiClient.getMessageSignalTiming();
  } catch (err) {
    logger.warn({ err }, "active-buzzer: failed to read signal timing config");
    return;
  }

  const beepCount = plan.beepCount ?? 1;
  const repeatSeconds = plan.repeatSeconds ?? 0;
  const signature = planSignature(plan.mode, beepCount, repeatSeconds, timing);

  // Same signature already started (whether it's still mid-burst, mid-
  // repeat-wait, or already finished a one-shot) - let it keep running
  // undisturbed rather than restarting mid-pattern every tick.
  if (lastSignature.get(process.id) === signature) return;

  stopBurst(process.id);
  lastSignature.set(process.id, signature);
  const onSeconds = plan.mode === "shortBeep" ? timing.short_beep_seconds : timing.long_beep_seconds;
  const pauseSeconds = plan.mode === "shortBeep" ? timing.short_beep_pause_seconds : timing.long_beep_pause_seconds;
  playBurst(process.id, process.device_id, beepCount, onSeconds, pauseSeconds, repeatSeconds, signature);
}
