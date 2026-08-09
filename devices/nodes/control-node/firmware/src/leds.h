// Three status LEDs (AGENTS_TO_DO.md, 2026-08-09) - green/yellow/red are
// mutually exclusive at any instant, decided entirely by `WatchdogState`
// from watchdog.h. This module only owns *how* each state blinks, not
// *when* to be in which state.
#pragma once

enum class WatchdogState {
  PulseOk,    // green flashes on each real pulse arrival, yellow/red off
  Booting,    // launched == false, no pulse ever received - yellow blinks, green/red off
  PulseLost,  // launched == true, pulse missing >2s - yellow/red alternate, green off
};

void ledsInit();

// Call once per loop() iteration. `justReceivedPulse` true only on the
// exact iteration a fresh CAN_ID_PULSE frame arrived - that is what
// (re)starts the green flash window, same "only pulses in direct
// response to a real event" semantics as the UI's own System Tick dot
// (nexus-edge AGENTS.md section 36) - not a free-running timer that
// would keep blinking even if pulses actually stopped.
void ledsUpdate(unsigned long now, WatchdogState state, bool justReceivedPulse);

// Current physical state of each LED - read by main.cpp to mirror onto
// CAN_ID_LEDS (canSendLeds) every tick, for NexusEdge-side visibility
// only (these three booleans are never written back to by NexusEdge).
bool ledsGreenIsOn();
bool ledsYellowIsOn();
bool ledsRedIsOn();
