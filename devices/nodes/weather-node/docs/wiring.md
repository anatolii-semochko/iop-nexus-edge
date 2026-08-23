# Weather Node - wiring (text schematic)

STM32F103C8T6 ("Blue Pill") + WCMCU-230 (VP230 chip, same CAN
transceiver as `control-node` - see that node's own wiring doc for
part-choice reasoning) CAN transceiver, mounted **outside**, away from
the enclosure (`Node Weather Control.txt`, AGENTS_TO_DO.md 2026-08-23).
Simplified/text-format, not a real schematic capture.

Firmware source: `../firmware/` (PlatformIO, STM32duino) - pin
`#define`s below match `../firmware/src/config.h` exactly; if either
changes, update both.

Unlike `control-node`, this board has no watchdog/LED/buzzer/reset
function and never receives a CAN frame - it only reads its three
sensors and transmits (readings + heartbeat). Liveness is monitored the
same way as any other node: Heartbeating Control watching this node's
`heartbeat` Device for staleness (AGENTS.md section on Heartbeating
Control), nothing firmware-side.

## Blue Pill pinout used

| Blue Pill pin | Function                          | Notes |
|----------------|-----------------------------------|-------|
| PA11           | CAN1 RX                           | fixed hardware pin, not configurable (unused by this firmware - TX only in practice, but the peripheral is always full-duplex) |
| PA12           | CAN1 TX                           | fixed hardware pin, not configurable |
| PB6            | I2C1 SCL (AHT20 + BMP280, shared bus) | both sensors share one I2C bus at different addresses - see "I2C sensors" below |
| PB7            | I2C1 SDA (AHT20 + BMP280, shared bus) | |
| PA0            | Photoresistor ADC input           | analog input, see "Light sensor" below |
| 3.3V / GND     | power                              | outdoor-rated enclosure/potting recommended - this board is exposed to weather, unlike `control-node`'s indoor unit |

## CAN bus

```
                 +-------------------+
   own CAN       |  WCMCU-230/VP230  |
   segment  <---> |   CAN transceiver | <--- PA11 (RX) / PA12 (TX)
   (outdoor run,  |   (3.3V native)   |
   own bus - see  +-------------------+
   note below)
```

Wiring to the transceiver module is identical to `control-node`'s own
(`3V3`/`GND`/`TXD`->PA12/`RXD`->PA11/`CANH`+`CANL` to the bus). Whether
this runs on its **own dedicated CAN segment** (recommended - this node
sits outside, at the end of a long run, and a fault or short outdoors
should not be able to take down the indoor enclosure bus `control-node`
shares with other nodes) or is extended from the same enclosure bus is a
per-installation wiring decision, not a firmware one - `CAN_BITRATE`
must match whichever bus it actually lands on either way. Defaulting to
the same 500 kbps as `control-node` below; revisit if wired onto a
different, differently-rated segment.

CAN bit rate and arbitration IDs: see `../firmware/src/config.h`'s own
`CAN_BITRATE`/`CAN_ID_*` block - reproduced here for reference. Uses the
`0x310`-`0x31F` block, deliberately leaving `0x306`-`0x30F` free for
`control-node`'s own possible future growth if these two ever do share
one physical bus:

| CAN ID  | Direction            | Payload |
|---------|----------------------|---------|
| 0x310   | node -> Raspberry (TX) | Uint32, 4 bytes - free-running heartbeat counter, same convention as `control-node`'s `0x301` |
| 0x311   | node -> Raspberry (TX) | Float32 @ offset 0 = temperature (C), Float32 @ offset 4 = humidity (%RH) - AHT20, same frame layout as `control-node`'s `0x302` |
| 0x312   | node -> Raspberry (TX) | Float32 @ offset 0 = pressure (hPa) - BMP280 |
| 0x313   | node -> Raspberry (TX) | Uint16 @ offset 0 = raw light level (uncalibrated ADC count) - photoresistor |

These same IDs/offsets are what a future `physical`/`transport: can`
EdgeX device profile (`canId`/`byteOffset` attributes) would use once a
real instance moves off `backend: virtual` - see `control-node`'s own
wiring doc for that same pattern (`nexus-edge-aquarium/extra-res/devices/`
convention).

## I2C sensors (AHT20 + BMP280, shared bus)

```
Blue Pill PB6 (SCL) ---- AHT20 SCL ---- BMP280 SCL
Blue Pill PB7 (SDA) ---- AHT20 SDA ---- BMP280 SDA
Blue Pill 3.3V      ---- AHT20 VCC ---- BMP280 VCC (3.3V variant only - see note)
Blue Pill GND       ---- AHT20 GND ---- BMP280 GND
```

Both sensors share one I2C1 bus at different fixed addresses - no
address conflict, no second bus needed:

- AHT20: `0x38` (`config.h`'s `AHT_I2C_ADDRESS`, same as `control-node`).
- BMP280: `0x76` (default) or `0x77` (if the module's `SDO` pin is tied
  high instead of low/floating - check the specific breakout in hand).
  `config.h`'s `BMP280_I2C_ADDRESS`.

Most AHT20/BMP280 breakout modules already carry their own I2C pull-up
resistors - no external ones needed with just these two devices on the
bus. **Buy the 3.3V-tolerant BMP280 breakout, not a 5V one** - this bus
runs at 3.3V logic throughout, same as the Blue Pill itself and the
AHT20.

## Light sensor (photoresistor)

Simple voltage-divider into one ADC-capable pin - no dedicated breakout
needed, just the photoresistor (LDR) and one fixed resistor:

```
Blue Pill 3.3V ---- Photoresistor ---+---- Blue Pill PA0 (ADC)
                                      |
                                     10k resistor
                                      |
Blue Pill GND  -----------------------+
```

10kOhm is a reasonable starting value for a typical CdS photoresistor
(brighter light -> lower LDR resistance -> higher voltage at the PA0
tap); tune once real components are in hand and the actual raw-value
range at day/night extremes is known - this is exactly what
`weather-control`'s own configurable zone boundaries
(`Node Weather Control.txt`'s zone-diagram config) are for, no firmware
change needed to retune classification thresholds later.

## Power

Outdoor-mounted - use a weatherproof enclosure/potting for the board and
all connections, and route the CAN/power cable run accordingly. Power
source (local supply vs. run from the same UPS-backed supply as
`control-node`) is a per-installation decision, not covered here.
