#pragma once

void envSensorInit();

// Returns true (and fills both outputs) only on the cycle a fresh
// reading was actually taken - same "call every loop(), most calls
// return false" shape as control-node's own sensorUpdate().
bool envSensorUpdate(unsigned long now, float *outTemperatureC, float *outHumidityPercent);
