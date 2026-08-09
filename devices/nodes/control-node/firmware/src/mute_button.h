// Debounced digital input only - the actual "mute lasts for this whole
// incident, clears on next pulse" latch logic lives in watchdog.cpp
// (it's the one that knows what "this incident" means), not here. This
// module just tells the caller, each loop() iteration, the button's
// current physical state and whether it was JUST pressed this iteration.
#pragma once

void muteButtonInit();
void muteButtonUpdate(unsigned long now);

// Debounced current state (LOW = pressed, internal pull-up - see
// config.h) - mirrored onto CAN_ID_BUTTON every tick by main.cpp.
bool muteButtonIsPressed();

// True for exactly one loop() iteration per physical press (debounced
// rising edge) - what watchdog.cpp actually acts on to set its mute
// latch, so a held-down button doesn't re-trigger anything every
// iteration.
bool muteButtonJustPressed();
