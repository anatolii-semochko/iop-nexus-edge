// Enclosure temperature/humidity sensor - two mutually-exclusive compile-
// time backends selected by config.h's SENSOR_USE_AHT (AGENTS_TO_DO.md,
// 2026-08-09): the target hardware AHT10/AHT20 (I2C, temperature +
// humidity), or a DS18B20 (1-Wire, temperature only) as a bring-up
// stand-in before AHT10/AHT20 arrives.
#pragma once

void sensorInit();

// Non-blocking - returns true only on iterations where a fresh reading
// was actually taken (see SENSOR_READ_INTERVAL_MS); callers should keep
// using the last values otherwise, same "call every loop(), acts only
// sometimes" shape as the other *Update() functions in this firmware.
// `outHasHumidity` is always false when built for DS18B20 - callers
// (main.cpp's canSendEnv call) must check it, not assume every read
// includes both fields.
bool sensorUpdate(unsigned long now, float *outTemperatureC, float *outHumidityPercent, bool *outHasHumidity);
