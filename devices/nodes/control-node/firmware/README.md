# control-node firmware

STM32F103C8T6 ("Blue Pill") firmware for the "НОДА КОНТРОЛЮ" watchdog
board (AGENTS_TO_DO.md, 2026-08-09) - see `../docs/wiring.md` for the
full pin/schematic reference and `../../../AGENTS.md` (nexus-edge, once
documented there) for the platform-side design.

## Status

**Written, not yet build/flash-tested against real hardware.** Blue
Pills and the MCP2551 CAN transceivers were ordered but not yet in hand
when this was written (AGENTS_TO_DO.md: "Blue Pill приїдуть тільки
завтра"); every constant/timing/protocol decision here traces back to an
explicit requirement in that same file, but the code itself has not been
compiled or run. Before trusting it on real hardware:

1. Build it (`pio run`) and fix whatever the STM32_CAN/OneWire/
   DallasTemperature library APIs turn out to actually look like versus
   what's assumed here (see each file's own "untested" note).
2. Bench-test each module in isolation before combining: LEDs/buzzer
   with `digitalWrite`/`tone` alone first, then the AHT20/DS18B20 sensor
   read, then CAN loopback (two boards, or a USB-CAN adapter) before
   trusting the full watchdog loop end to end.
3. Confirm the AHT20 vs AHT10 init command byte (`sensor.cpp`'s own
   comment) against whichever chip actually arrives.

## Layout

- `src/config.h` - every tunable constant (pins, CAN IDs, all timing).
  Change values here, not inline elsewhere - see its own header comment.
- `src/main.cpp` - `setup()`/`loop()`, wires every module together.
- `src/watchdog.{h,cpp}` - the core autonomous state machine (`launched`,
  the shared "time since last pulse" clock, LED state, buzzer stage,
  reset-attempt schedule). Has zero dependency on CAN/NexusEdge being
  reachable - this is the part that must keep working after NexusEdge
  itself has crashed.
- `src/can_bus.{h,cpp}` - thin wrapper around the STM32_CAN library.
- `src/leds.{h,cpp}`, `src/buzzer.{h,cpp}` - physical output drivers.
- `src/mute_button.{h,cpp}` - debounced button read (the mute *latch*
  itself lives in watchdog.cpp, not here).
- `src/reset_output.{h,cpp}` - non-blocking reset-line pulse.
- `src/sensor.{h,cpp}` - AHT10/AHT20 (I2C) or DS18B20 (1-Wire) enclosure
  reading, selected at compile time by `config.h`'s `SENSOR_USE_AHT`.

## Building

```
pio run                 # build
pio run --target upload # flash via ST-Link (see platformio.ini)
pio device monitor       # serial monitor, if anything is ever added to it
```

No serial logging exists yet (nothing in this firmware writes to
`Serial`) - add it ad hoc while bench-testing if useful, it's not part
of the design.

## Why Arduino framework, not raw HAL

The board is sold as "Arduino IDE compatible", and STM32duino's Arduino
core handles clock/NVIC init that would otherwise need to be hand-
verified against this specific board with no way to test it here. Using
established libraries (STM32_CAN, OneWire/DallasTemperature) for the two
genuinely timing-sensitive protocols (CAN, 1-Wire) also meaningfully
lowers the risk of a subtle bug versus hand-rolling either from scratch
sight-unseen.
