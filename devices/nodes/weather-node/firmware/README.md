# weather-node firmware

STM32F103C8T6 ("Blue Pill") firmware for the outdoor weather station
(`Node Weather Control.txt`, AGENTS_TO_DO.md 2026-08-23) - see
`../docs/wiring.md` for the full pin/schematic reference.

## Status

**Not yet built or flashed** - components ordered 2026-08-23, not yet in
hand. Written by analogy with `../../control-node/firmware/` (same
STM32duino + PlatformIO toolchain, same STM32_CAN library, same
"UNTESTED" caveat that project's own README carried before its first
real build) - logic reasoned through, not verified against real
hardware. Expect the same class of build-time surprises control-node hit
(`HAL_CAN_MODULE_ENABLED` already applied here proactively, since it's a
known, documented STM32_CAN + STM32duino requirement, not something to
rediscover) and update this file once real hardware is in hand, same as
that project's own README does.

## Layout

- `src/config.h` - every tunable constant (pins, CAN IDs, all timing).
  Change values here, not inline elsewhere.
- `src/main.cpp` - `setup()`/`loop()`, wires every module together. No
  watchdog state machine here (unlike control-node) - this is a pure
  sensor station, transmit-only.
- `src/can_bus.{h,cpp}` - thin wrapper around the STM32_CAN library,
  transmit-only (no `canBusReceive()` - nothing is ever sent to this
  node).
- `src/env_sensor.{h,cpp}` - AHT20 (I2C), temperature + humidity. Same
  protocol/register layout as control-node's own AHT20 path.
- `src/pressure_sensor.{h,cpp}` - BMP280 (I2C, shares the bus with
  AHT20 at a different address), pressure only - its own temperature
  output is read but discarded.
- `src/light_sensor.{h,cpp}` - photoresistor (ADC), raw uncalibrated
  reading. No calibration/lux conversion - classification into a
  human-meaningful level happens platform-side (weather-control
  process), not in firmware.

## Building

```
pio run                 # build
pio run --target upload # flash via ST-Link (see platformio.ini)
pio device monitor       # serial monitor, if anything is ever added to it
```

## Why Arduino framework, not raw HAL

Same reasoning as `../../control-node/firmware/README.md`'s own section -
reused verbatim here rather than re-litigated.
