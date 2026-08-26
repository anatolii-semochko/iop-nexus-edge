#pragma once

#include <stdint.h>

void canBusInit();
void canSendUint32(uint32_t id, uint32_t value);
void canSendEnv(float temperatureC, float humidityPercent);
void canSendPressure(float pressureHpa);
void canSendLight(uint16_t rawLight);
