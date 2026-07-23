import React from 'react'

/**
 * Interactive slider for the Light Regulator's Dev Simulator row -
 * simulates a person physically turning the dial. Pure/controlled: knows
 * nothing about HTTP - the caller (apps/ui's Dev Simulator page) owns
 * fetching the current value and pushing changes through
 * PUT .../resources/Level/simulate (AGENTS.md section 7).
 */
const LightRegulatorSimulator = ({ value, min = 0, max = 100, step = 1, disabled = false, onChange }) => (
  <div className="d-flex align-items-center gap-2">
    <input
      type="range"
      className="form-range"
      min={min}
      max={max}
      step={step}
      value={value ?? min}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ maxWidth: 220 }}
    />
    <span className="font-monospace">{value ?? '-'}</span>
  </div>
)

export default LightRegulatorSimulator
