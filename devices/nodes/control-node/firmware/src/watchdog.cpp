#include "watchdog.h"
#include "config.h"
#include "reset_output.h"

#include <Arduino.h>  // uint8_t/uint32_t - none of the headers above bring in <stdint.h>

static bool launched = false;
static unsigned long lastPulseAt = 0;
static bool muted = false;
static uint8_t resetAttemptsUsed = 0;

static WatchdogState currentLedState = WatchdogState::Booting;
static BuzzerStage currentBuzzerStage = BuzzerStage::Silent;

// Cumulative thresholds from the same shared elapsed clock (config.h) -
// indexed by resetAttemptsUsed (0 -> first attempt's own threshold, etc).
static const unsigned long RESET_THRESHOLDS_MS[RESET_MAX_ATTEMPTS] = {
    RESET_ATTEMPT_1_MS,
    RESET_ATTEMPT_2_MS,
    RESET_ATTEMPT_3_MS,
};

void watchdogInit() {
  launched = false;
  lastPulseAt = 0;
  muted = false;
  resetAttemptsUsed = 0;
  currentLedState = WatchdogState::Booting;
  currentBuzzerStage = BuzzerStage::Silent;
}

void watchdogUpdate(unsigned long now, bool pulseReceived, bool muteJustPressed) {
  if (pulseReceived) {
    lastPulseAt = now;
    launched = true;
    // "Перший імпульс в шині скидає цей процес на будь-якому кроці" -
    // both the mute latch and the reset-attempt counter start fresh on
    // every real pulse, not just the first one ever.
    muted = false;
    resetAttemptsUsed = 0;
  }

  if (muteJustPressed) {
    muted = true;
  }

  if (!launched) {
    // Boot state - no pulse has ever arrived this power cycle yet, so
    // "elapsed since last pulse" is meaningless; nothing below (buzzer,
    // reset attempts) applies during boot, only the yellow LED does.
    currentLedState = WatchdogState::Booting;
    currentBuzzerStage = BuzzerStage::Silent;
    return;
  }

  unsigned long elapsed = now - lastPulseAt;

  if (elapsed < PULSE_LOST_THRESHOLD_MS) {
    currentLedState = WatchdogState::PulseOk;
    currentBuzzerStage = BuzzerStage::Silent;
    return;
  }

  currentLedState = WatchdogState::PulseLost;

  if (elapsed >= BUZZER_STAGE_CONTINUOUS_MS) {
    currentBuzzerStage = BuzzerStage::Continuous;
  } else if (elapsed >= BUZZER_STAGE_LONG_BEEP_MS) {
    currentBuzzerStage = BuzzerStage::LongBeep;
  } else if (elapsed >= BUZZER_STAGE_SHORT_BEEP_MS) {
    currentBuzzerStage = BuzzerStage::ShortBeep;
  } else {
    // Past the >2s LED threshold but not yet the 1-minute buzzer stage -
    // blinking yellow/red, still silent.
    currentBuzzerStage = BuzzerStage::Silent;
  }

  // Forced-reset schedule - independent of mute (checked above), stops
  // permanently after RESET_MAX_ATTEMPTS for this incident (user's own
  // spec: "Після третьої спроби нічого не робимо, зупиняємося").
  if (resetAttemptsUsed < RESET_MAX_ATTEMPTS && elapsed >= RESET_THRESHOLDS_MS[resetAttemptsUsed]) {
    resetAttemptsUsed++;
    triggerResetPulse(now);
  }
}

WatchdogState watchdogLedState() { return currentLedState; }
BuzzerStage watchdogBuzzerStage() { return currentBuzzerStage; }
bool watchdogIsMuted() { return muted; }
