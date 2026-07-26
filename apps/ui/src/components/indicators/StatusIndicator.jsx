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
const StatusIndicator = ({ active, color = '#0d6efd' }) => (
  <div
    style={{
      width: INDICATOR_SIZE,
      height: INDICATOR_SIZE,
      borderRadius: '50%',
      border: `${BORDER_WIDTH}px solid #000`,
      backgroundColor: active ? color : INACTIVE_FILL,
      boxSizing: 'border-box',
      margin: '0 auto',
    }}
  />
)

export default StatusIndicator
