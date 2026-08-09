// "НОДА КОНТРОЛЮ" firmware entry point (AGENTS_TO_DO.md, 2026-08-09).
//
// This is the Raspberry Pi watchdog board's own program - everything in
// watchdog.cpp (launched flag, pulse-loss LED/buzzer escalation, forced-
// reset schedule) runs entirely independent of whether NexusEdge/the
// Raspberry Pi is alive, reachable, or even powered. That independence is
// the whole point of this board: it must keep signaling a failure even
// after the very software stack it's watching has crashed. CAN
// telemetry (heartbeat/env/mirror frames) is the "soft" side - useful
// when NexusEdge IS alive, never required for the watchdog logic itself
// to function correctly.
//
// UNTESTED against real hardware as of writing - see config.h's own
// header note and ../README.md before flashing.

#include <Arduino.h>

#include "buzzer.h"
#include "can_bus.h"
#include "config.h"
#include "leds.h"
#include "mute_button.h"
#include "reset_output.h"
#include "sensor.h"
#include "watchdog.h"

static uint32_t heartbeatCounter = 0;
static unsigned long lastHeartbeatSentAt = 0;
static unsigned long lastMirrorSentAt = 0;

void setup() {
  ledsInit();
  buzzerInit();
  muteButtonInit();
  resetOutputInit();
  sensorInit();
  watchdogInit();
  canBusInit();
}

void loop() {
  unsigned long now = millis();

  // 1. Poll CAN for a fresh pulse frame - payload never inspected, only
  // arrival matters (config.h's own CAN_ID_PULSE comment).
  uint8_t rxData[8];
  uint8_t rxLen;
  bool pulseReceived = canBusReceive(CAN_ID_PULSE, rxData, &rxLen);

  // 2. Debounced button read.
  muteButtonUpdate(now);

  // 3. Core autonomous state machine - see watchdog.h/.cpp. Everything
  // from here through step 4 keeps working with zero CAN traffic at all.
  watchdogUpdate(now, pulseReceived, muteButtonJustPressed());

  // 4. Drive physical outputs from the watchdog's current decision.
  ledsUpdate(now, watchdogLedState(), pulseReceived);
  buzzerUpdate(now, watchdogBuzzerStage(), watchdogIsMuted());
  resetOutputUpdate(now);

  // 5. This node's own heartbeat, once/sec - the node -> NexusEdge
  // liveness direction (sensor/heartbeat's own contract.schema.ts).
  if (now - lastHeartbeatSentAt >= HEARTBEAT_TX_INTERVAL_MS) {
    lastHeartbeatSentAt = now;
    heartbeatCounter++;
    canSendUint32(CAN_ID_HEARTBEAT, heartbeatCounter);
  }

  // 6. Enclosure sensor - only actually reads/sends on its own interval
  // (sensorUpdate returns false most iterations - see sensor.h).
  float temperatureC = 0.0f;
  float humidityPercent = 0.0f;
  bool hasHumidity = false;
  if (sensorUpdate(now, &temperatureC, &humidityPercent, &hasHumidity)) {
    canSendEnv(temperatureC, humidityPercent, hasHumidity);
  }

  // 7. Mirror LED/buzzer/button state for NexusEdge-side visibility only
  // (read-only from NexusEdge's perspective - see each device type's own
  // contract.schema.ts) - rate-limited, not sent every loop() iteration.
  if (now - lastMirrorSentAt >= MIRROR_TX_INTERVAL_MS) {
    lastMirrorSentAt = now;
    canSendLeds(ledsGreenIsOn(), ledsYellowIsOn(), ledsRedIsOn());
    canSendBool(CAN_ID_BUZZER, buzzerIsSounding());
    canSendBool(CAN_ID_BUTTON, muteButtonIsPressed());
  }
}
