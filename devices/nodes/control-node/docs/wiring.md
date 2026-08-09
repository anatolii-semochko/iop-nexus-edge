# Control Node - wiring (text schematic)

STM32F103C8T6 ("Blue Pill") + MCP2551 CAN transceiver, mounted in the
same enclosure as the Raspberry Pi it watches (AGENTS_TO_DO.md,
2026-08-09 "НОДА КОНТРОЛЮ"). Simplified/text-format per the original
request - not a real schematic capture, just "which line/pin goes where".

Firmware source: `../firmware/` (PlatformIO, STM32duino) - pin `#define`s
below match `../firmware/src/config.h` exactly; if either changes, update
both.

## Blue Pill pinout used

| Blue Pill pin | Function                          | Notes |
|----------------|-----------------------------------|-------|
| PA11           | CAN1 RX                           | fixed hardware pin, not configurable |
| PA12           | CAN1 TX                           | fixed hardware pin, not configurable |
| PB6            | I2C1 SCL (AHT10/AHT20)            | |
| PB7            | I2C1 SDA (AHT10/AHT20)            | |
| PB8            | 1-Wire data (DS18B20, bring-up only) | needs external ~4.7kOhm pull-up to 3.3V |
| PA0            | LED Green (pulse OK)               | through a current-limiting resistor (~330R for a typical 3mm/5mm LED at 3.3V logic) |
| PA1            | LED Yellow (booting / pulse missing) | same |
| PA2            | LED Red (pulse lost after launch)  | same |
| PA3            | Buzzer (passive) - PWM/tone output | TIM2_CH4-capable pin, needed for two-tone stage-3 alarm |
| PA4            | Mute Beeper button                 | internal pull-up enabled in firmware; button to GND |
| PA5            | Reset output (node's own side of the reset contact) | see "Reset line" below |
| 3.3V / GND     | power                              | this board's own supply is independent/continuous (UPS), per the user's own requirement - NOT shared with the Raspberry Pi's own 5V rail |

## CAN bus

```
                 +-------------------+
   enclosure     |   MCP2551 (or     |
   CAN bus  <---> |   TJA1050) CAN    | <--- PA11 (RX) / PA12 (TX)
   (shared with   |   transceiver     |
   other nodes)   +-------------------+
```

The Blue Pill's own STM32F103 has a built-in CAN controller (bxCAN) but
**no transceiver on the board itself** - PA11/PA12 are logic-level
TX/RX only. The MCP2551 (already in hand per AGENTS_TO_DO.md) converts
those to the bus's real differential CANH/CANL pair. Standard wiring:
transceiver `TXD`/`RXD` to PA12/PA11, `CANH`/`CANL` to the enclosure's
existing bus, `VCC`/`GND` to this board's own supply. A 120Ω termination
resistor across CANH/CANL is only needed if this node sits at a physical
end of the bus - match whatever the enclosure's existing CAN wiring
already does.

CAN bit rate and arbitration IDs: see `../firmware/src/config.h`'s own
`CAN_BITRATE`/`CAN_ID_*` block - reproduced here for reference:

| CAN ID  | Direction            | Payload |
|---------|----------------------|---------|
| 0x300   | Raspberry -> node (RX) | Bool, 1 byte - "pulse", value irrelevant, only arrival matters |
| 0x301   | node -> Raspberry (TX) | Uint32, 4 bytes - free-running heartbeat counter |
| 0x302   | node -> Raspberry (TX) | Float32 @ offset 0 = temperature (C), Float32 @ offset 4 = humidity (%RH, zero-filled/ignored if this instance has no humidity sensor) |
| 0x303   | node -> Raspberry (TX, mirror only) | Bool @0 = green, @1 = yellow, @2 = red |
| 0x304   | node -> Raspberry (TX, mirror only) | Bool, 1 byte - buzzer currently sounding |
| 0x305   | node -> Raspberry (TX, mirror only) | Bool, 1 byte - Mute Beeper currently held |

These same IDs/offsets are what a future `physical`/`transport: can`
EdgeX device profile (`canId`/`byteOffset` attributes) would use once
this node moves off `backend: virtual` in
`nexus-edge-aquarium/extra-res/devices/control-node-devices.yaml` - see
that file's own header comment.

## Enclosure sensor (temperature/humidity)

Target hardware - AHT10/AHT20 (I2C):

```
Blue Pill PB6 (SCL) ---- AHT20 SCL
Blue Pill PB7 (SDA) ---- AHT20 SDA
Blue Pill 3.3V      ---- AHT20 VCC
Blue Pill GND       ---- AHT20 GND
```

Most AHT10/AHT20 breakout modules already carry their own I2C pull-up
resistors - no external ones needed in the common case. I2C address is
fixed at `0x38` for both chips (`config.h`'s `AHT_I2C_ADDRESS`).

Bring-up stand-in - DS18B20 (1-Wire, temperature only, no humidity):

```
Blue Pill PB8  ---- DS18B20 DQ (data)
Blue Pill 3.3V ---- DS18B20 VDD
Blue Pill GND  ---- DS18B20 GND
                    + external ~4.7kOhm resistor between PB8 and 3.3V
                    (1-Wire bus pull-up - not optional, the bus won't
                    work without it)
```

Switching between the two is a firmware compile-time choice
(`config.h`'s `SENSOR_USE_AHT`), not a runtime auto-detect - see
`../firmware/src/sensor.cpp`.

## LEDs, buzzer, Mute Beeper button

All four are simple GPIO-level connections to the panel-mounted
components (per the original request: "роз'єми для індикаторів і кнопки,
які встановлені на панелі корпусу" - the LEDs/buzzer/button live on the
enclosure's front panel, wired back to this board via header connectors,
not soldered directly to it):

```
PA0 --[330R]-- LED Green anode  -- LED cathode -- GND
PA1 --[330R]-- LED Yellow anode -- LED cathode -- GND
PA2 --[330R]-- LED Red anode    -- LED cathode -- GND
PA3 ---------- Passive buzzer +  -- buzzer - -- GND
PA4 ---------- Mute Beeper button -- other button leg -- GND
               (no external pull-up needed - INPUT_PULLUP in firmware)
```

Passive buzzer, not active - firmware drives it via PWM/`tone()` (needed
for the two-tone continuous alarm at stage 3, which an active buzzer
- fixed single tone, on/off only - couldn't produce).

## Reset line

```
                    mechanical enable switch
                    (operator-installed, NOT      Raspberry Pi's own
                    sensed by firmware)            reset header/pins
PA5 (this board) ----[switch, open by default]---- RaspberryResetContact
   "CurrentNodeResetContact"
```

Firmware always attempts its 3-stage reset pulse schedule (5/15/30
minutes after pulse loss, `config.h`'s `RESET_ATTEMPT_*_MS`) regardless
of this switch's position - the switch is a pure hardware gate the
operator installs and controls physically; this firmware never reads its
state (confirmed with the user, AGENTS_TO_DO.md 2026-08-09: "Прошивка
завжди намагається reset, стан перемикача не сенсимо"). Leave the switch
open (disconnected) to disable auto-reset entirely without touching
firmware at all.

## Power

This board's own 3.3V/GND supply is independent and continuous (UPS-
backed), explicitly NOT sharing a rail with the Raspberry Pi
(AGENTS_TO_DO.md, 2026-08-09: "я організую безперервне живлення плати
самостійно") - so a Raspberry Pi power loss is itself just another form
of "pulse missing" this board correctly detects and escalates on, rather
than also taking this board down with it.
