import { useEffect, useState } from 'react'
import { subscribeToLiveEvents } from './liveSocket'

/**
 * Counts system ticks relayed over the Socket Server (AGENTS_TO_DO.md,
 * 2026-08-01) - each apps/orchestrator tick (its 1s compute loop) fires a
 * bare Redis Pub/Sub notify via apps/api's POST /system/tick, relayed by
 * apps/messaging-gateway as a `system.tick` WS event carrying nothing but
 * a timestamp. The returned counter increments once per tick received -
 * SystemTickIndicator.jsx uses it as a React `key` to retrigger a CSS
 * pulse animation on every change, not as a value with meaning of its own.
 */
export function useSystemTick() {
  const [count, setCount] = useState(0)

  useEffect(
    () =>
      subscribeToLiveEvents(({ routingKey }) => {
        if (routingKey !== 'system.tick') return
        setCount((prev) => prev + 1)
      }),
    [],
  )

  return count
}
