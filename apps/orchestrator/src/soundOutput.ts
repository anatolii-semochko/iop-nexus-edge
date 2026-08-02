// Shared sound-output driver (AGENTS_TO_DO.md, 2026-08-02) - extracted
// from processes/activeBuzzer.ts, which was the platform's first (and
// until now only) consumer, when the Alarm Annunciator process became
// the second. Given an `AlarmPlan` (alarmPolicy.ts's output) and the
// admin's `message_signal_timing` config, drives one boolean buzzer
// device accordingly - `constant` mode holds it on directly, no timer;
// `shortBeep`/`longBeep` schedule a burst of `beepCount` beeps (each on
// for the style's on-duration, off for its pause, no trailing pause
// after the last one), then either replay after `repeatSeconds` (> 0)
// or stop and stay silent (=== 0 - edge-triggered, plays once per
// activation).
//
// Every process id gets its own independent burst state - nothing stops
// two sound-output processes (Active Zummer, Alarm Annunciator, more
// later) running at once, each with its own device and its own alarm
// condition.

import { apiClient } from "./apiClient.js";
import type { AlarmPlan } from "./alarmPolicy.js";
import { logger } from "./logger.js";

interface BurstState {
  timeoutHandle: ReturnType<typeof setTimeout>;
  // What this burst chain is currently playing - compared against a
  // fresh tick's plan to decide whether to let it keep running
  // (repeatSeconds > 0, still mid-cycle) or start over.
  signature: string;
}
const bursts = new Map<number, BurstState>();

// The signature of the last burst *started* for this process, kept even
// after a one-shot (repeatSeconds === 0) burst finishes playing -
// without this, a finished one-shot burst would look identical to
// "never started" on the next tick (its `bursts` entry is gone once
// done) and would incorrectly replay every tick for as long as the
// condition stays active.
const lastSignature = new Map<number, string>();

function stopBurst(processId: number): void {
  const burst = bursts.get(processId);
  if (!burst) return;
  clearTimeout(burst.timeoutHandle);
  bursts.delete(processId);
}

function writeBuzzer(deviceId: number, value: boolean): void {
  apiClient.setDeviceAuto(deviceId, value).catch((err) => {
    logger.warn({ err, deviceId, value }, "soundOutput: failed to write buzzer device");
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

/**
 * Call once per tick per sound-output process. `plan` is
 * `determineAlarmPlan`'s result for this process's own alarm condition
 * (`null` = nothing active - silence). Fetches `message_signal_timing`
 * itself when the plan needs it (constant/off/null don't).
 */
export async function driveSoundOutput(processId: number, deviceId: number, plan: AlarmPlan | null): Promise<void> {
  if (!plan) {
    stopBurst(processId);
    lastSignature.delete(processId);
    writeBuzzer(deviceId, false);
    return;
  }

  if (plan.mode === "constant") {
    // Handled without a tick, per spec - held on directly, no pulsing.
    stopBurst(processId);
    lastSignature.delete(processId);
    writeBuzzer(deviceId, true);
    return;
  }

  let timing: Awaited<ReturnType<typeof apiClient.getMessageSignalTiming>>;
  try {
    timing = await apiClient.getMessageSignalTiming();
  } catch (err) {
    logger.warn({ err }, "soundOutput: failed to read signal timing config");
    return;
  }

  const beepCount = plan.beepCount ?? 1;
  const repeatSeconds = plan.repeatSeconds ?? 0;
  const signature = planSignature(plan.mode, beepCount, repeatSeconds, timing);

  // Same signature already started (whether it's still mid-burst,
  // mid-repeat-wait, or already finished) - let it keep running
  // undisturbed rather than restarting mid-pattern every tick.
  if (lastSignature.get(processId) === signature) return;

  stopBurst(processId);
  lastSignature.set(processId, signature);
  const onSeconds = plan.mode === "shortBeep" ? timing.short_beep_seconds : timing.long_beep_seconds;
  const pauseSeconds = plan.mode === "shortBeep" ? timing.short_beep_pause_seconds : timing.long_beep_pause_seconds;
  playBurst(processId, deviceId, beepCount, onSeconds, pauseSeconds, repeatSeconds, signature);
}

/** Process turned off, or otherwise needs to go immediately silent
 * without waiting for the next `driveSoundOutput` call (e.g. the on->off
 * edge, handled outside the per-tick alarm-plan flow). */
export function silenceSoundOutput(processId: number, deviceId: number): void {
  stopBurst(processId);
  lastSignature.delete(processId);
  writeBuzzer(deviceId, false);
}
