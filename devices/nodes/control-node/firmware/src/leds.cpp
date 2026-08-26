#include "leds.h"
#include "config.h"

#include <Arduino.h>

static bool greenOn = false;
static bool yellowOn = false;
static bool redOn = false;

// 0 = never received a pulse this power cycle - greenWindowEndAt stays in
// the past until the first real arrival, so ledsUpdate never accidentally
// lights green before that.
static unsigned long greenWindowEndAt = 0;

void ledsInit() {
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_YELLOW, LOW);
  digitalWrite(PIN_LED_RED, LOW);
}

void ledsUpdate(unsigned long now, WatchdogState state, bool justReceivedPulse) {
  if (justReceivedPulse) {
    greenWindowEndAt = now + LED_GREEN_PULSE_ON_MS;
  }

  switch (state) {
    case WatchdogState::PulseOk:
      greenOn = now < greenWindowEndAt;
      yellowOn = false;
      redOn = false;
      break;

    case WatchdogState::Booting:
      greenOn = false;
      yellowOn = (now % LED_YELLOW_BOOT_BLINK_PERIOD_MS) < (LED_YELLOW_BOOT_BLINK_PERIOD_MS / 2);
      redOn = false;
      break;

    case WatchdogState::PulseLost: {
      greenOn = false;
      bool yellowPhase = (now % LED_YELLOW_RED_ALTERNATE_PERIOD_MS) < (LED_YELLOW_RED_ALTERNATE_PERIOD_MS / 2);
      yellowOn = yellowPhase;
      redOn = !yellowPhase;
      break;
    }
  }

  digitalWrite(PIN_LED_GREEN, greenOn ? HIGH : LOW);
  digitalWrite(PIN_LED_YELLOW, yellowOn ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, redOn ? HIGH : LOW);
}

bool ledsGreenIsOn() { return greenOn; }
bool ledsYellowIsOn() { return yellowOn; }
bool ledsRedIsOn() { return redOn; }
