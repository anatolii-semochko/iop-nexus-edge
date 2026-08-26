// BMP280 via Adafruit_BMP280 (see ../platformio.ini) - shares the same
// I2C1 bus as env_sensor.cpp's AHT20 (different fixed address, see
// config.h's BMP280_I2C_ADDRESS / ../../docs/wiring.md). Only pressure is
// read - BMP280's own temperature output is deliberately unused (AHT20
// already covers temperature, see devices/standalone/sensor/pressure's
// own contract comment). UNTESTED against real hardware (config.h's own
// header note).

#include "pressure_sensor.h"
#include "config.h"

#include <Arduino.h>
#include <Adafruit_BMP280.h>

static Adafruit_BMP280 bmp;
static bool bmpOk = false;
static unsigned long lastReadAt = 0;

void pressureSensorInit() {
  bmpOk = bmp.begin(BMP280_I2C_ADDRESS);
  if (!bmpOk) return;

  // Standard/indoor-navigation-ish sampling profile - plenty for a
  // once-every-couple-of-seconds ambient reading, not tuned for speed.
  bmp.setSampling(Adafruit_BMP280::MODE_NORMAL,
                   Adafruit_BMP280::SAMPLING_X2,   // temperature (unused, but the chip always samples both)
                   Adafruit_BMP280::SAMPLING_X16,  // pressure
                   Adafruit_BMP280::FILTER_X16,
                   Adafruit_BMP280::STANDBY_MS_500);
}

bool pressureSensorUpdate(unsigned long now, float *outPressureHpa) {
  if (!bmpOk) return false;
  if (now - lastReadAt < ENV_READ_INTERVAL_MS) return false;
  lastReadAt = now;

  *outPressureHpa = bmp.readPressure() / 100.0f;  // Pa -> hPa
  return true;
}
