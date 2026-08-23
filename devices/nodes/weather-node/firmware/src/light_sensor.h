#pragma once

void lightSensorInit();

// Returns true (and fills the output) only on the cycle a fresh reading
// was actually taken.
bool lightSensorUpdate(unsigned long now, uint16_t *outRawLight);
