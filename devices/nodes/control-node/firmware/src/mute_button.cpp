#include "mute_button.h"
#include "config.h"

#include <Arduino.h>

static bool debouncedPressed = false;
static bool rawPressedLast = false;
static unsigned long lastChangeAt = 0;
static bool justPressed = false;

void muteButtonInit() {
  pinMode(PIN_MUTE_BUTTON, INPUT_PULLUP);
  rawPressedLast = digitalRead(PIN_MUTE_BUTTON) == LOW;
  debouncedPressed = rawPressedLast;
}

void muteButtonUpdate(unsigned long now) {
  justPressed = false;

  bool rawPressed = digitalRead(PIN_MUTE_BUTTON) == LOW;
  if (rawPressed != rawPressedLast) {
    rawPressedLast = rawPressed;
    lastChangeAt = now;
  }

  if ((now - lastChangeAt) >= MUTE_BUTTON_DEBOUNCE_MS && rawPressed != debouncedPressed) {
    debouncedPressed = rawPressed;
    if (debouncedPressed) justPressed = true;
  }
}

bool muteButtonIsPressed() { return debouncedPressed; }
bool muteButtonJustPressed() { return justPressed; }
