#include "reset_output.h"
#include "config.h"

#include <Arduino.h>

static bool pulseActive = false;
static unsigned long pulseEndAt = 0;

void resetOutputInit() {
  pinMode(PIN_RESET_OUTPUT, OUTPUT);
  digitalWrite(PIN_RESET_OUTPUT, LOW);
}

void triggerResetPulse(unsigned long now) {
  digitalWrite(PIN_RESET_OUTPUT, HIGH);
  pulseActive = true;
  pulseEndAt = now + RESET_PULSE_DURATION_MS;
}

void resetOutputUpdate(unsigned long now) {
  if (pulseActive && now >= pulseEndAt) {
    digitalWrite(PIN_RESET_OUTPUT, LOW);
    pulseActive = false;
  }
}
