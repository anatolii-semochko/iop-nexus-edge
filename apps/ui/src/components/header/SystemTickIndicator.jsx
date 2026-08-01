import React from 'react'
import { useSystemTick } from '../../api/useSystemTick'

/**
 * Small green header dot, left of the Notification icons (AGENTS_TO_DO.md,
 * 2026-08-01) - pulses once per system tick delivered over the Socket
 * Server (useSystemTick). Uses the tick counter as this span's own `key`:
 * React remounts the element on every change, which restarts the CSS
 * animation (`.system-tick-pulse`, style.scss) from its 0% frame each
 * time - a continuous `infinite` animation (NotificationCenter.jsx's
 * `.wem-blink-ring`) would keep blinking even if ticks actually stopped
 * arriving, which defeats the point of a live indicator: the dot only
 * ever pulses in response to a real tick, and sits dim between them.
 */
const SystemTickIndicator = () => {
  const tickCount = useSystemTick()

  return (
    <span
      key={tickCount}
      className="system-tick-dot system-tick-pulse"
      role="status"
      aria-label="System tick"
      title="System tick"
    />
  )
}

export default SystemTickIndicator
