// The core autonomous state machine (AGENTS_TO_DO.md, 2026-08-09) - owns
// `launched`, the single shared "elapsed since last pulse" clock, and
// decides the current LED state / buzzer stage / whether a reset attempt
// is due. Deliberately has NO dependency on can_bus.h or NexusEdge being
// reachable at all - this must keep working after NexusEdge itself has
// crashed, that is the entire point of this board (see main.cpp's own
// header comment).
#pragma once

#include "buzzer.h"
#include "leds.h"

void watchdogInit();

// Call once per loop() iteration.
//   pulseReceived     - true only on the iteration a fresh CAN_ID_PULSE
//                        frame arrived (sets launched=true the first
//                        time, resets the elapsed clock, clears mute and
//                        the reset-attempt counter - AGENTS_TO_DO.md:
//                        "Перший імпульс в шині скидає цей процес на
//                        будь-якому кроці").
//   muteJustPressed   - true only on the iteration Mute Beeper was
//                        freshly pressed (mute_button.h's debounced
//                        edge) - latches mute for the rest of this
//                        incident; does NOT affect reset attempts
//                        (confirmed with the user: "Ми робимо три
//                        спроби RESET незалежно, чи натискали 'Mute
//                        Beeper'").
void watchdogUpdate(unsigned long now, bool pulseReceived, bool muteJustPressed);

WatchdogState watchdogLedState();
BuzzerStage watchdogBuzzerStage();
bool watchdogIsMuted();
