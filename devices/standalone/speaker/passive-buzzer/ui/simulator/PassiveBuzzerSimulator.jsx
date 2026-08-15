import React from 'react'

/**
 * Clickable variant of `../control/PassiveBuzzerControl.jsx` for the Dev
 * Simulator page - same visual, toggles on click instead of just
 * displaying state. See `../active-buzzer`'s own ActiveBuzzerSimulator.jsx
 * for the identical precedent this mirrors.
 */
const GRILLE_COLOR = '#ced4da'

const PassiveBuzzerSimulator = ({ value, onChange }) => {
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

export default PassiveBuzzerSimulator
