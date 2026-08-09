/**
 * Humidity - atomic sensor, independent library Device type (AGENTS.md
 * section 7/30/32), first added 2026-08-09 alongside `../temperature` as
 * a pair for the "НОДА КОНТРОЛЮ" watchdog board (AGENTS_TO_DO.md) - its
 * environment sensor (target hardware AHT10/AHT20, one physical I2C chip
 * reporting both temperature and humidity) is modeled as two separate
 * atomic Devices, not one compound "environment" device, same as every
 * other Device type in this library (see `../temperature`'s own contract
 * comment - "no `resources` map... exactly one value").
 *
 * A single relative-humidity reading: reports its current value, never
 * accepts commands. No forbidden-state rules of its own (safety.yaml) -
 * same reasoning as `../temperature`.
 */
export const humidityContract = {
  deviceType: 'humidity',
  readOnly: true,
  valueType: 'Float32',
  units: '%RH',
  description: 'Relative humidity sensor',
}
