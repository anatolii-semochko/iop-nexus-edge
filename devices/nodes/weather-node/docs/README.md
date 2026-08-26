# Weather Node

STM32 node meant to be mounted **outdoors**, away from the enclosure -
a pure sensor station reading local temperature, humidity, atmospheric
pressure, and daylight level. Unlike most other nodes on this platform,
it never receives a command: it only reads its sensors and transmits.

## Hardware

Three physical sensors, five Devices on a real instance:

| Sensor | Reads | Devices |
|---|---|---|
| AHT20 (I2C) | temperature + humidity | `temperature` (°C), `humidity` (%RH) |
| BMP280 (I2C) | atmospheric pressure | `pressure` (hPa) - the module's own temperature output is read and discarded, AHT20 already covers that |
| Photoresistor (ADC) | raw ambient light | `light` (raw 0-4095 count, uncalibrated) |
| - | *(computed, no sensor of its own)* | `light-level` - a 6-step category derived from `light` by the `weather-control` process, see below |

Plus `heartbeat`, posted once per second - 6 Devices total on a real
instance.

## Light level

`light-level` is not read from hardware - the `weather-control` process
classifies the raw `light` reading into one of six named zones every
tick, from darkest to brightest:

| Zone | Icon |
|---|---|
| Dark | moon |
| Dusk | contrast |
| Overcast | cloud |
| Medium | cloudy |
| Sunny | brightness/sun |
| Very sunny | sun |

This lets other processes (e.g. aquarium lighting) react to "is it
sunny outside" without each of them re-implementing their own
threshold logic against the raw ADC count.

## Configuring the zone boundaries (process Settings popup)

Open the `weather-control` process's Settings popup, **Configuration**
tab, section "Light level zones":

- A color swatch per zone, next to its icon and name.
- A horizontal diagram of all 6 zones, proportional to the raw
  0-4095 range, with a dashed vertical marker showing where the
  *current* live raw reading falls.
- One boundary editor per border between two adjacent zones (e.g.
  "Dusk / Overcast") - a stepper field for that boundary's raw value,
  constrained to stay strictly between its two neighboring zones so
  zones can never cross or invert, plus an **Accept current value**
  button that snaps the boundary to wherever the live raw reading is
  right now (handy for calibrating against real day/night extremes
  once hardware is installed).
- **Save**/**Cancel** at the bottom of the popup, same as any other
  process's settings - nothing here takes effect until Save is pressed.

The shipped defaults are an even split across the full 0-4095 range and
are only a starting point - retune them once real day/night raw values
are known outdoors.

## Process detail (Processes page, expandable row)

Read-only display of all five readings: Temperature, Humidity,
Pressure, Light (raw), and Light level (icon + name). There is nothing
to edit here - the only configurable behavior (the zone boundaries
above) lives in the Settings popup, not this panel.

## Known limitations

- No physical board exists yet - this node type stays `backend:
  virtual` until hardware is assembled and flashed.
- The raw `light` reading is uncalibrated; the shipped default zone
  boundaries are a placeholder even split, not tuned against a real
  photoresistor.
- This node type has no watchdog/LED/buzzer/reset function - liveness
  is monitored the same way as any other node, via Heartbeating
  Control watching `heartbeat` for staleness, nothing firmware-side.
