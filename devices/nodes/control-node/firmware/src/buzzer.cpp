#include "buzzer.h"
#include "config.h"

#include <Arduino.h>

static bool sounding = false;

// Currently-playing frequency, 0 = silent (noTone()'d). loop() calls
// buzzerUpdate() every iteration with no throttling, so without this,
// tone()/noTone() would fire hundreds/thousands of times a second while
// a stage is active - STM32duino's tone() resets the underlying timer
// on every call, and calling it that fast produced an audible crackle
// (found live, 2026-08-14, on real hardware - not a hardware quirk).
// Only call tone()/noTone() again when the target actually changes.
static unsigned int activeToneHz = 0;

static void setTone(unsigned int toneHz) {
  if (toneHz == activeToneHz) return;
  if (toneHz == 0) {
    noTone(PIN_BUZZER);
  } else {
    tone(PIN_BUZZER, toneHz);
  }
  activeToneHz = toneHz;
}

void buzzerInit() {
  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);
  activeToneHz = 0;
}

static void silence() {
  setTone(0);
  sounding = false;
}

static void pulsedTone(unsigned long now, unsigned long onMs, unsigned long periodMs, unsigned int toneHz) {
  bool on = (now % periodMs) < onMs;
  setTone(on ? toneHz : 0);
  sounding = on;
}

void buzzerUpdate(unsigned long now, BuzzerStage stage, bool muted) {
  if (muted) {
    silence();
    return;
  }

  switch (stage) {
    case BuzzerStage::Silent:
      silence();
      break;

    case BuzzerStage::ShortBeep:
      pulsedTone(now, BEEP_SHORT_ON_MS, BEEP_SHORT_PERIOD_MS, BEEP_TONE_HZ);
      break;

    case BuzzerStage::LongBeep:
      pulsedTone(now, BEEP_LONG_ON_MS, BEEP_LONG_PERIOD_MS, BEEP_TONE_HZ);
      break;

    case BuzzerStage::Continuous: {
      // Relentless - always sounding, just switching between the two
      // alarm tones every BEEP_ALARM_TONE_SWITCH_MS, no silent gap
      // (distinct from the two pulsed stages above).
      bool firstTone = (now % (2 * BEEP_ALARM_TONE_SWITCH_MS)) < BEEP_ALARM_TONE_SWITCH_MS;
      setTone(firstTone ? BEEP_ALARM_TONE_1_HZ : BEEP_ALARM_TONE_2_HZ);
      sounding = true;
      break;
    }
  }
}

bool buzzerIsSounding() { return sounding; }
