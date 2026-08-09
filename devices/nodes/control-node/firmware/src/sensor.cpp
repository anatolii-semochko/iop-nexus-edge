#include "sensor.h"
#include "config.h"

#include <Arduino.h>

#if SENSOR_USE_AHT

// AHT20 protocol (AHT10 is register-compatible except for its own init
// command byte, noted below) - Wire (I2C) only, no extra library: the
// protocol is a handful of fixed command bytes, not worth a dependency
// for. UNTESTED against real hardware (config.h's own header note).
#include <Wire.h>

static bool ahtCalibrated = false;
static unsigned long lastReadAt = 0;

static bool ahtReadStatus(uint8_t *status) {
  if (Wire.requestFrom(AHT_I2C_ADDRESS, 1) != 1) return false;
  *status = Wire.read();
  return true;
}

void sensorInit() {
  Wire.begin();
  delay(40);  // AHT20 datasheet: >=40ms after power-up before first command

  uint8_t status = 0;
  ahtReadStatus(&status);
  if ((status & 0x08) == 0) {
    // Not calibrated yet - send the init/calibrate command. 0xBE is the
    // AHT20 command; AHT10 uses 0xE1 with the same two parameter bytes -
    // change this one byte if building for an AHT10 instead.
    Wire.beginTransmission(AHT_I2C_ADDRESS);
    Wire.write(0xBE);
    Wire.write(0x08);
    Wire.write(0x00);
    Wire.endTransmission();
    delay(10);
  }
  ahtCalibrated = true;
}

bool sensorUpdate(unsigned long now, float *outTemperatureC, float *outHumidityPercent, bool *outHasHumidity) {
  *outHasHumidity = true;

  if (now - lastReadAt < SENSOR_READ_INTERVAL_MS) return false;
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

  if (data[0] & 0x80) return false;  // busy bit still set - reading not ready, skip this cycle

  uint32_t humidityRaw = ((uint32_t)data[1] << 12) | ((uint32_t)data[2] << 4) | (data[3] >> 4);
  uint32_t tempRaw = (((uint32_t)data[3] & 0x0F) << 16) | ((uint32_t)data[4] << 8) | data[5];

  *outHumidityPercent = (float)humidityRaw / 1048576.0f * 100.0f;    // / 2^20
  *outTemperatureC = (float)tempRaw / 1048576.0f * 200.0f - 50.0f;   // / 2^20
  return true;
}

#else  // DS18B20 bring-up stand-in (temperature only)

#include <DallasTemperature.h>
#include <OneWire.h>

static OneWire oneWire(PIN_ONE_WIRE);
static DallasTemperature ds18b20(&oneWire);

static unsigned long lastRequestAt = 0;
static bool conversionPending = false;
// 12-bit resolution (DallasTemperature's own default) conversion time -
// datasheet worst case, with a small margin.
static const unsigned long DS18B20_CONVERSION_MS = 800;

void sensorInit() {
  ds18b20.begin();
  ds18b20.setWaitForConversion(false);  // non-blocking - this firmware polls instead of delay()ing
}

bool sensorUpdate(unsigned long now, float *outTemperatureC, float *outHumidityPercent, bool *outHasHumidity) {
  (void)outHumidityPercent;
  *outHasHumidity = false;  // DS18B20 has no humidity - see sensor.h

  if (!conversionPending) {
    if (now - lastRequestAt < SENSOR_READ_INTERVAL_MS) return false;
    lastRequestAt = now;
    ds18b20.requestTemperatures();
    conversionPending = true;
    return false;
  }

  if (now - lastRequestAt < DS18B20_CONVERSION_MS) return false;

  float tempC = ds18b20.getTempCByIndex(0);
  conversionPending = false;
  if (tempC == DEVICE_DISCONNECTED_C) return false;

  *outTemperatureC = tempC;
  return true;
}

#endif
