// AHT20 protocol, identical to control-node's own AHT20 path
// (../../control-node/firmware/src/sensor.cpp) - Wire (I2C) only, no
// extra library, same fixed command bytes. UNTESTED against real
// hardware (config.h's own header note).

#include "env_sensor.h"
#include "config.h"

#include <Arduino.h>
#include <Wire.h>

static bool ahtCalibrated = false;
static unsigned long lastReadAt = 0;

static bool ahtReadStatus(uint8_t *status) {
  if (Wire.requestFrom(AHT_I2C_ADDRESS, 1) != 1) return false;
  *status = Wire.read();
  return true;
}

void envSensorInit() {
  Wire.begin();
  delay(40);  // AHT20 datasheet: >=40ms after power-up before first command

  uint8_t status = 0;
  ahtReadStatus(&status);
  if ((status & 0x08) == 0) {
    Wire.beginTransmission(AHT_I2C_ADDRESS);
    Wire.write(0xBE);
    Wire.write(0x08);
    Wire.write(0x00);
    Wire.endTransmission();
    delay(10);
  }
  ahtCalibrated = true;
}

bool envSensorUpdate(unsigned long now, float *outTemperatureC, float *outHumidityPercent) {
  if (now - lastReadAt < ENV_READ_INTERVAL_MS) return false;
  lastReadAt = now;

  if (!ahtCalibrated) return false;

  Wire.beginTransmission(AHT_I2C_ADDRESS);
  Wire.write(0xAC);
  Wire.write(0x33);
  Wire.write(0x00);
  Wire.endTransmission();
  delay(80);  // datasheet: measurement takes up to ~80ms

  if (Wire.requestFrom(AHT_I2C_ADDRESS, 6) != 6) return false;
  uint8_t data[6];
  for (uint8_t i = 0; i < 6; i++) data[i] = Wire.read();

  if (data[0] & 0x80) return false;  // busy bit still set - skip this cycle

  uint32_t humidityRaw = ((uint32_t)data[1] << 12) | ((uint32_t)data[2] << 4) | (data[3] >> 4);
  uint32_t tempRaw = (((uint32_t)data[3] & 0x0F) << 16) | ((uint32_t)data[4] << 8) | data[5];

  *outHumidityPercent = (float)humidityRaw / 1048576.0f * 100.0f;    // / 2^20
  *outTemperatureC = (float)tempRaw / 1048576.0f * 200.0f - 50.0f;   // / 2^20
  return true;
}
