// "weather-node" firmware entry point (Node Weather Control.txt,
// AGENTS_TO_DO.md 2026-08-23).
//
// Pure sensor station - unlike control-node, there is no watchdog state
// machine here: this loop just reads three sensors on their own
// intervals and transmits readings + a heartbeat, once/sec. Liveness is
// entirely Heartbeating Control's job on the platform side (watching
// this node's `heartbeat` Device for staleness), not this firmware's.
//
// UNTESTED against real hardware as of writing - see config.h's own
// header note and ../README.md before flashing.

#include <Arduino.h>

#include "can_bus.h"
#include "config.h"
#include "env_sensor.h"
#include "light_sensor.h"
#include "pressure_sensor.h"

static uint32_t heartbeatCounter = 0;
static unsigned long lastHeartbeatSentAt = 0;

void setup() {
  envSensorInit();
  pressureSensorInit();
  lightSensorInit();
  canBusInit();
}

void loop() {
  unsigned long now = millis();

  // 1. This node's own heartbeat, once/sec - same convention as
  // control-node (sensor/heartbeat's own contract.schema.ts: only
  // change-over-time matters to the reader, not the value itself).
  if (now - lastHeartbeatSentAt >= HEARTBEAT_TX_INTERVAL_MS) {
    lastHeartbeatSentAt = now;
    heartbeatCounter++;
    canSendUint32(CAN_ID_HEARTBEAT, heartbeatCounter);
  }

  // 2. AHT20 - temperature + humidity, one CAN frame (mirrors
  // control-node's own CAN_ID_ENV layout).
  float temperatureC = 0.0f;
  float humidityPercent = 0.0f;
  if (envSensorUpdate(now, &temperatureC, &humidityPercent)) {
    canSendEnv(temperatureC, humidityPercent);
  }

  // 3. BMP280 - pressure only (its own temperature output is unused,
  // see pressure_sensor.cpp's own header comment).
  float pressureHpa = 0.0f;
  if (pressureSensorUpdate(now, &pressureHpa)) {
    canSendPressure(pressureHpa);
  }

  // 4. Photoresistor - raw light level. weather-control's own process
  // derives the categorical light-level Device from this raw value
  // platform-side, not here.
  uint16_t rawLight = 0;
  if (lightSensorUpdate(now, &rawLight)) {
    canSendLight(rawLight);
  }
}
