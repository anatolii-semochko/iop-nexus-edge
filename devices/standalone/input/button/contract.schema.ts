/**
 * Button - atomic manual-input device, independent library Device type
 * (AGENTS.md section 7/30/32). Momentary pushbutton, normally-open -
 * reads `true` only while physically held, `false` otherwise (distinct
 * from `switch`, which latches).
 *
 * Graduated from a catalog-only entry (library.json + icon.svg + docs
 * stub, AGENTS_TO_DO.md 2026-08-02 elementary-components package) to
 * this full file set 2026-08-09, once it got a real consumer - the
 * "НОДА КОНТРОЛЮ" watchdog board's own "Mute Beeper" button
 * (AGENTS_TO_DO.md, "control-node" node type).
 *
 * `readOnly: false`, same convention as `../switch` (its own contract
 * comment: RW at the Devices API level even though nothing legitimately
 * *commands* a real physical button - this is what lets the Dev
 * Simulator's `.../simulate` endpoint push a simulated press through
 * core-command at all for a `backend: virtual` instance).
 */
export const buttonContract = {
  deviceType: 'button',
  readOnly: false,
  valueType: 'Bool',
  description: 'Momentary pushbutton (normally-open) - true while held',
}
