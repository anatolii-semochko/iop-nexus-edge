import React from 'react'

/**
 * Clickable variant of `../control/LedControl.jsx` for the Dev Simulator
 * page - same visual (bold black bezel, light gray off / `color` on),
 * but toggles on click instead of just displaying state. Pure/controlled,
 * same shape as `../../../../actuator/light-regulator/ui/simulator/
 * LightRegulatorSimulator.jsx` - knows nothing about HTTP, the caller
 * (apps/ui's Dev Simulator page) owns fetching/pushing through
 * `PUT /devices/:id/simulate`.
 */
const DEFAULT_COLOR = '#0d6efd'
const INACTIVE_FILL = '#ced4da'

const LedSimulator = ({ value, color = DEFAULT_COLOR, onChange }) => {
  const active = value === true
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      style={{
        width: 25,
        height: 25,
        borderRadius: '50%',
        border: '3px solid #000',
        backgroundColor: active ? color : INACTIVE_FILL,
        boxSizing: 'border-box',
        padding: 5,
        cursor: 'pointer',
      }}
      aria-pressed={active}
      aria-label="Toggle LED"
    />
  )
}

export default LedSimulator
