import { useEffect, useState } from 'react'
import { subscribeToLiveEvents, subscribeToLiveStatus } from './liveSocket'

/**
 * Live overlay for one device - {value, mode, valueAuto, valueManual,
 * timestamp}, patched in as events arrive over the shared WebSocket
 * (apps/messaging-gateway, AGENTS.md section 9), on top of whatever a page
 * already loaded via the REST API. Flat now, not keyed by resource name
 * (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor) - a Device is atomic,
 * exactly one value.
 *
 * Subscribes once, keyed by every device's own id, rather than
 * resubscribing (and resetting local state mid-effect) whenever
 * `deviceId` changes - besides avoiding a synchronous setState-in-effect,
 * this means switching between devices doesn't churn the WebSocket
 * listener, and a device's last-seen values are still there if you
 * navigate back to it.
 */
export function useDeviceLiveState(deviceId) {
  const [byDevice, setByDevice] = useState({})

  useEffect(
    () =>
      subscribeToLiveEvents(({ event }) => {
        if (event.domain !== 'device') return
        setByDevice((prev) => ({
          ...prev,
          [event.entityId]: {
            value: event.value,
            mode: event.mode,
            valueAuto: event.valueAuto,
            valueManual: event.valueManual,
            // AGENTS.md section 62 - only present when this event was
            // published because the overdue status itself changed (an
            // ordinary Dual Devices Model write doesn't carry these) -
            // left undefined otherwise so DevicesList.jsx's own `??`
            // fallback to the last REST fetch's value keeps working.
            isOverdue: event.isOverdue,
            expiresAt: event.expiresAt,
            timestamp: event.timestamp,
          },
        }))
      }),
    [],
  )

  return byDevice[deviceId] ?? {}
}

/** Whether the shared live WebSocket is currently connected - for a small "Live" indicator. */
export function useLiveConnectionStatus() {
  const [status, setStatus] = useState(false)
  useEffect(() => subscribeToLiveStatus(setStatus), [])
  return status
}
