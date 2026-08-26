#pragma once

void pressureSensorInit();

// Returns true (and fills the output) only on the cycle a fresh reading
// was actually taken.
bool pressureSensorUpdate(unsigned long now, float *outPressureHpa);
