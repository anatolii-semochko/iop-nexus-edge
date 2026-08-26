/**
 * Light - atomic sensor, independent library Device type (AGENTS.md
 * section 7/30/32), added 2026-08-23 for the "weather-node" outdoor
 * station (AGENTS_TO_DO.md) - raw photoresistor (LDR) reading, uncalibrated
 * (the STM32's own 12-bit ADC count, not a photometric lux value - no lux
 * conversion is attempted, the sensor isn't characterized for one). This
 * is the raw NUMBER; the derived 6-level category
 * (`../light-level`, "дуже сонячно".."темно") is a separate, computed
 * Device - see that device type's own contract for why it's modeled
 * separately rather than as a second field here (AGENTS.md section 30 -
 * a Device is atomic, exactly one value).
 *
 * A single reading: reports its current value, never accepts commands.
 * No forbidden-state rules of its own (safety.yaml) - same reasoning as
 * `../temperature`/`../humidity`/`../pressure`.
 */
export const lightContract = {
  deviceType: 'light',
  readOnly: true,
  valueType: 'Uint16',
  units: 'raw',
  description: 'Raw photoresistor (LDR) light-level reading, uncalibrated ADC count',
}
