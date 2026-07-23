import React from 'react'

/**
 * Production, read-only view of the Light Regulator's current position - a
 * disabled slider used purely as a visual gauge (AGENTS.md section 7's
 * ui/control: "production control/visualization component"). Never
 * interactive - this device has no command surface at all, it only
 * reports its position.
 */
const LightRegulatorControl = ({ value, min = 0, max = 100 }) => (
  <div className="d-flex align-items-center gap-2">
    <input
      type="range"
      className="form-range"
      min={min}
      max={max}
      value={value ?? min}
      disabled
      readOnly
      style={{ maxWidth: 220 }}
    />
    <span className="font-monospace">{value ?? '-'}</span>
  </div>
)

export default LightRegulatorControl
