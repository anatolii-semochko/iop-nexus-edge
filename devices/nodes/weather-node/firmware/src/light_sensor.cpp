// Plain voltage-divider photoresistor read - no library, no calibration
// (see devices/standalone/sensor/light's own contract comment - this is
// a raw, uncalibrated ADC count, not a lux value). UNTESTED against real
// hardware (config.h's own header note).

#include "light_sensor.h"
#include "config.h"

#include <Arduino.h>

static unsigned long lastReadAt = 0;

void lightSensorInit() {
  analogReadResolution(12);  // 0-4095, matches this device type's documented range
  pinMode(PIN_LIGHT_ADC, INPUT_ANALOG);
}

bool lightSensorUpdate(unsigned long now, uint16_t *outRawLight) {
  if (now - lastReadAt < LIGHT_READ_INTERVAL_MS) return false;
  lastReadAt = now;

  *outRawLight = (uint16_t)analogRead(PIN_LIGHT_ADC);
  return true;
}
