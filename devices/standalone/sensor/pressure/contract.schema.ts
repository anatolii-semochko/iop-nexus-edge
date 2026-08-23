/**
 * Pressure - atomic sensor, independent library Device type (AGENTS.md
 * section 7/30/32), added 2026-08-23 for the "weather-node" outdoor
 * station (AGENTS_TO_DO.md) - target hardware BMP280 (I2C), which also
 * has its own temperature output, deliberately unused: weather-node
 * already covers temperature via its AHT20 (`../temperature`), so this
 * device type only ever reports pressure, same "one physical chip, only
 * the non-redundant readings become Devices" reasoning as `../humidity`'s
 * own contract comment for its AHT20 pairing.
 *
 * A single relative-humidity-sibling reading: reports its current value,
 * never accepts commands. No forbidden-state rules of its own
 * (safety.yaml) - same reasoning as `../temperature`/`../humidity`.
 */
export const pressureContract = {
  deviceType: 'pressure',
  readOnly: true,
  valueType: 'Float32',
  units: 'hPa',
  description: 'Atmospheric pressure sensor',
}
