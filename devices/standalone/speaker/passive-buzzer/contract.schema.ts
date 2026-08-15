/**
 * Passive Buzzer - standalone virtual actuator (AGENTS.md section 7).
 * Same single-Bool "is it sounding" shape as `../active-buzzer` from
 * NexusEdge's own point of view (still just `true`/`false`, still no
 * tone/frequency control here) - the real difference is entirely on the
 * firmware/hardware side: a passive buzzer has no built-in oscillator,
 * so producing ANY sound at all requires the driving MCU to generate the
 * waveform itself (PWM/`tone()`), unlike an active buzzer which just
 * needs power applied. Modeled as its own device type (not a config flag
 * on active-buzzer) purely for that physical/firmware distinction and
 * for its own Library icon - the EdgeX/CAN contract is intentionally
 * unchanged (control-node's real instance still uses the existing
 * `NexusEdge-ActiveBuzzer` EdgeX profile, canId 0x304 - see
 * `../../../nodes/control-node/docs/wiring.md`).
 *
 * First real instance: control-node's own buzzer (2026-08-14 correction
 * - `firmware/src/buzzer.cpp` genuinely drives it via `tone()`/`noTone()`,
 * confirmed live when the tone()-every-loop() crackle bug was found and
 * fixed, AGENTS.md section 51 - it was mistakenly modeled as
 * `active-buzzer` before that was noticed).
 *
 * A Device is atomic (AGENTS.md section 30) - exactly one value, so this
 * contract has no `resources` map.
 */
export const passiveBuzzerContract = {
  deviceType: 'passive-buzzer',
  valueType: 'Bool',
  // Mirror-only for control-node's own real instance (CAN_ID_BUZZER,
  // firmware-autonomous - NexusEdge only observes, never drives it) - but
  // not read-only at the type level, since a future non-mirrored instance
  // (a passive buzzer NexusEdge itself commands, the same way
  // active-buzzer's own alarm process does) is a legitimate use of this
  // same type. Per-instance `capabilities.readOnly` is what actually
  // decides this for a given real device, same as every other type here.
  readOnly: false,
  description: 'Passive buzzer, driven via PWM/tone() - true sounds, false is silent',
}
