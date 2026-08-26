// Drives PIN_RESET_OUTPUT (this node's own side of the operator's
// mechanical CurrentNodeResetContact <-> RaspberryResetContact switch -
// see config.h) - a brief non-blocking HIGH pulse, not a blocking
// delay(), so the rest of the watchdog loop (LEDs/buzzer/CAN) keeps
// running normally while a reset pulse is in flight.
#pragma once

void resetOutputInit();

// Starts one pulse. watchdog.cpp is the only caller, and only decides
// *when* (the 5/15/30-minute schedule, max 3 attempts) - this module has
// no opinion on that, it just pulses when told to.
void triggerResetPulse(unsigned long now);

// Must be called every loop() iteration - turns the pin back off once
// RESET_PULSE_DURATION_MS has elapsed. A no-op when no pulse is active.
void resetOutputUpdate(unsigned long now);
