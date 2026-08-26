import React from 'react'

/**
 * Production, read-only view of this LED's currently commanded state - a
 * bold-bezel circular lamp, light gray when off, `color` when on. Never
 * interactive (AGENTS.md section 7's ui/control: "production
 * control/visualization component") - added 2026-08-09 alongside the
 * "control-node" node type's own three LEDs, the first real DevicesList/
 * DevSimulator consumer of this device kind (previously only rendered
 * inline via the app's own generic StatusIndicator, DevicesList.jsx).
 *
 * `color` is optional instance data (`device.capabilities.color`, a hex
 * string) - the `led` device kind itself stays a generic single-color
 * Bool with no color field of its own; this just lets each *instance*
 * (e.g. Alarm Annunciator's red/yellow pairs, this node's green/yellow/
 * red trio) hint at its own intended color instead of every LED in the
 * app rendering identically. Defaults to a neutral blue, same default
 * `apps/ui/src/components/indicators/StatusIndicator.jsx` already uses,
 * for any instance that doesn't set one.
 *
 * Deliberately a self-contained component, not `StatusIndicator` itself -
 * device-type components under devices/ have zero knowledge of
 * `@coreui/react`/the app's own component tree (AGENTS.md section 7's
 * cross-package resolution note, also documented on
 * `../../../active-buzzer/ui/control/ActiveBuzzerControl.jsx`) - the two
 * intentionally look identical (same bold black bezel + colored fill)
 * since both represent the same physical fixture.
 */
const DEFAULT_COLOR = '#0d6efd'
const INACTIVE_FILL = '#ced4da'

const LedControl = ({ value, color = DEFAULT_COLOR }) => {
  const active = value === true
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '5px solid #000',
        backgroundColor: active ? color : INACTIVE_FILL,
        boxSizing: 'border-box',
        margin: '0 auto',
      }}
    />
  )
}

export default LedControl
