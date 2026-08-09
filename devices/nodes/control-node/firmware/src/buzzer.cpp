#include "buzzer.h"
#include "config.h"

#include <Arduino.h>

static bool sounding = false;

void buzzerInit() {
  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);
}

static void silence() {
  noTone(PIN_BUZZER);
  sounding = false;
}

static void pulsedTone(unsigned long now, unsigned long onMs, unsigned long periodMs, unsigned int toneHz) {
  bool on = (now % periodMs) < onMs;
  if (on) {
    tone(PIN_BUZZER, toneHz);
  } else {
    noTone(PIN_BUZZER);
  }
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
      tone(PIN_BUZZER, firstTone ? BEEP_ALARM_TONE_1_HZ : BEEP_ALARM_TONE_2_HZ);
      sounding = true;
      break;
    }
  }
}

bool buzzerIsSounding() { return sounding; }
