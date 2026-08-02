import React from 'react'

/**
 * Production, read-only view of the Active Zummer's currently commanded
 * state - a plain boolean lamp (AGENTS.md section 7's ui/control:
 * "production control/visualization component"). Never interactive - the
 * `active-buzzer` process (apps/orchestrator) is the only writer, driven
 * by the fleet-wide alarm policy, not a user action here.
 *
 * Deliberately a plain dumb component, not `BuzzerIndicator` itself
 * (apps/ui/src/components/indicators/BuzzerIndicator.jsx) - device-type
 * components under devices/ have zero knowledge of `@coreui/react`/the
 * app's own component tree (AGENTS.md section 7's cross-package resolution
 * note), so this stays a self-contained lamp rather than importing across
 * that boundary; the two intentionally look identical (same black/red
 * body + light-gray "grille" dot) since both represent the same physical
 * fixture.
 */
const GRILLE_COLOR = '#ced4da'

const ActiveBuzzerControl = ({ value }) => {
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

export default ActiveBuzzerControl
