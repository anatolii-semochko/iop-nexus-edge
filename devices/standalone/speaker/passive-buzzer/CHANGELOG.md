# Changelog

## 2026-08-14

- Initial version: split out of `active-buzzer` for control-node's real
  buzzer, which genuinely drives via PWM/`tone()` (no built-in
  oscillator) - see contract.schema.ts's own header for why this is a
  separate type rather than a flag on active-buzzer. Same single `Buzzer`
  (`Bool`) shape, same `NexusEdge-ActiveBuzzer` EdgeX profile reused
  unchanged (this is a NexusEdge-side taxonomy/icon distinction, not an
  EdgeX/CAN contract change).
