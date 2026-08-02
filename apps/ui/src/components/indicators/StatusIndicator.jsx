import React from 'react'
import { INDICATOR_SIZE } from './constants'

const BORDER_WIDTH = 5
const INACTIVE_FILL = '#ced4da'

/**
 * Elementary status light - a bold black circular bezel around a fill that
 * reads the boolean state: light gray inactive, `color` active. Physical-
 * panel-indicator look, not a flat dot - first extracted from a pair of
 * ad-hoc Cooler/Heater circles duplicated inline in TemperatureProcessPanel.jsx,
 * now shared by anything else that wants the same "LED" visual instead of
 * redrawing it per call site.
 */
// `size`/`borderWidth` default to the full footprint - pass
// MINI_INDICATOR_SIZE/MINI_BORDER_WIDTH (constants.js) for a panel with
// many indicators at once (AGENTS_TO_DO.md, 2026-08-02).
const StatusIndicator = ({
  active,
  color = '#0d6efd',
  size = INDICATOR_SIZE,
  borderWidth = BORDER_WIDTH,
}) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      border: `${borderWidth}px solid #000`,
      backgroundColor: active ? color : INACTIVE_FILL,
      boxSizing: 'border-box',
      margin: '0 auto',
    }}
  />
)

export default StatusIndicator
