# control-node firmware

STM32F103C8T6 ("Blue Pill") firmware for the "НОДА КОНТРОЛЮ" watchdog
board (AGENTS_TO_DO.md, 2026-08-09) - see `../docs/wiring.md` for the
full pin/schematic reference and `../../../AGENTS.md` (nexus-edge, once
documented there) for the platform-side design.

## Status

**Builds and flashes clean on real hardware as of 2026-08-11** (ST-Link
V2 clone, `st-info --probe` confirms `STM32F1xx_MD`/chipid `0x410` -
this specific board's flash reports 128KB, not the nominal 64KB C8T6
figure, a well-known "bonus flash" trait of many C8T6 clones actually
carrying a CBT6 die). `pio run --target upload`: "Programming
Finished" / "Verified OK". Real transceiver in hand turned out to be a
WCMCU-230 (VP230 chip) rather than the originally speculated MCP2551 -
`../docs/wiring.md` corrected accordingly (3.3V-native, arguably a
better match for this board than a 5V part would've been anyway).

**One real build bug found and fixed**: STM32duino's default HAL config
does not compile in the CAN HAL module unless `HAL_CAN_MODULE_ENABLED`
is defined - without it, `STM32_CAN.cpp` fails with a cascade of
"`CAN_HandleTypeDef` was not declared"/"`struct stm32_can_t` has no
member named `handle`" errors. Fixed via `platformio.ini`'s
`build_flags` (the STM32_CAN library's own header documents this exact
flag as the fix, once you know to look for it).

**CAN loop verified live as of 2026-08-12** - a Y4126-CAN-PRO-2 USB-CAN
adapter (enumerates as `0c72:000c PEAK System PCAN-USB`, a compatible
clone; picked up by the kernel's own `peak_usb` driver with no extra
vendor software, exposed as a plain SocketCAN `can0`) was wired onto the
same physical bus as the board. `candump` confirmed the board
transmitting `CAN_ID_HEARTBEAT` once/sec with a monotonically
incrementing counter, and `CAN_ID_LEDS` correctly reporting
`WatchdogState::Booting` (yellow, blinking) with no pulse frames on the
bus. Sending one `CAN_ID_PULSE` frame by hand (`cansend can0 300#01`)
produced the exact expected transition through `PulseOk` and back down
to `PulseLost` after `PULSE_LOST_THRESHOLD_MS` (2s) with no further
pulses - `watchdog.cpp`'s state machine confirmed genuinely running
against real CAN hardware, not just theoretically per the source. No
`CAN_ID_ENV` frames seen yet, as expected - no sensor wired, and
`sensorUpdate()` only sends on a successful read (`main.cpp:75`).

**Not yet verified**: the physical LED/buzzer/button/reset outputs
themselves - everything confirmed above went through the CAN mirror
frames only, no peripheral has actually been wired to the board yet.
Next steps, in order:

1. Wire a single LED (PA1/yellow, see wiring.md) and confirm it
   visually blinks ~1Hz in `Booting` state - the CAN mirror already
   proves `leds.cpp`'s internal state is correct, this step confirms
   the physical GPIO/wiring matches it.
2. Bench-test each remaining module in isolation before combining:
   buzzer via `tone()`, the AHT20/DS18B20 sensor read, mute button,
   reset-line pulse - before trusting the full watchdog loop end to
   end on real peripherals.
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
