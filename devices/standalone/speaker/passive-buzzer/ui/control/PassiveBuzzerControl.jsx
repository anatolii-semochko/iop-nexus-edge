import React from 'react'

/**
 * Production, read-only view of a Passive Buzzer's currently mirrored/
 * commanded state - visually identical to `../active-buzzer`'s own
 * ActiveBuzzerControl.jsx (same black/red body + light-gray "grille"
 * dot), since NexusEdge only ever sees the same boolean state either
 * way - see this type's own contract.schema.ts for what actually
 * differs (firmware/hardware, not this component).
 */
const GRILLE_COLOR = '#ced4da'

const PassiveBuzzerControl = ({ value }) => {
  const active = value === true
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: active ? '#dc3545' : '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: GRILLE_COLOR }} />
    </div>
  )
}

export default PassiveBuzzerControl
