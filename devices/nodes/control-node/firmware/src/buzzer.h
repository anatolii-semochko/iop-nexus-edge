// Passive buzzer escalation (AGENTS_TO_DO.md, 2026-08-09) - all timing
// from config.h. `mute` silences every stage for the current incident
// only (watchdog.cpp owns clearing mute on the next real pulse - this
// module just obeys whatever it's told each call, no memory of its own
// about *why* it's silent).
#pragma once

enum class BuzzerStage {
  Silent,      // pulse present, or not yet past the first escalation threshold
  ShortBeep,   // BUZZER_STAGE_SHORT_BEEP_MS elapsed
  LongBeep,    // BUZZER_STAGE_LONG_BEEP_MS elapsed
  Continuous,  // BUZZER_STAGE_CONTINUOUS_MS elapsed - two-tone alarm
};

void buzzerInit();
void buzzerUpdate(unsigned long now, BuzzerStage stage, bool muted);

// Physical sounding state right now (false whenever muted, or Silent, or
// mid-gap between short/long beep pulses) - mirrored onto CAN_ID_BUZZER
// every tick by main.cpp, same "NexusEdge only observes, never drives"
// role as leds.h's own state getters.
bool buzzerIsSounding();
