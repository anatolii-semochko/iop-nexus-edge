/**
 * LED - atomic indicator device, independent library Device type
 * (AGENTS.md section 7/30/32). Single-color, on/off - a PWM-dimmable
 * variant would be a distinct device type, not a mode of this one (same
 * split `light-regulator` already draws for its own dimming behavior).
 *
 * Graduated from a catalog-only entry (library.json + icon.svg + docs
 * stub) to this full file set once it got a real consumer - the Alarm
 * Annunciator node/process (AGENTS_TO_DO.md, 2026-08-02).
 *
 * This is the single source of truth this device type's EdgeX profile
 * (edgex-device-profile.yaml) and Postgres seeds are meant to agree
 * with. Nothing yet reads this file at runtime across process
 * boundaries (Go, SQL) - see the Implementation status note in AGENTS.md
 * section 7: kept in sync by hand today, same as every other device type.
 */
export const ledContract = {
  deviceType: 'led',
  readOnly: false,
  valueType: 'Bool',
  description: 'Single-color status LED - on/off indicator output',
}
