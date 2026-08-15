import React from 'react'

/**
 * Clickable variant of `../control/ActiveBuzzerControl.jsx` for the Dev
 * Simulator page - same visual (black body / red-when-active + light-gray
 * grille dot), but toggles on click instead of just displaying state.
 * Added 2026-08-09 for the "control-node" node type's own buzzer - the
 * first Dev Simulator consumer of this device kind (previously a plain
 * checkbox there, same generic fallback every device type without a
 * registered simulator still gets).
 */
const GRILLE_COLOR = '#ced4da'

const ActiveBuzzerSimulator = ({ value, onChange }) => {
  const active = value === true
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        backgroundColor: active ? '#dc3545' : '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-pressed={active}
      aria-label="Toggle buzzer"
    >
      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: GRILLE_COLOR }} />
    </button>
  )
}

export default ActiveBuzzerSimulator
