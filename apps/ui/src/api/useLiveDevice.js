import { useEffect, useState } from 'react'
import { subscribeToLiveEvents, subscribeToLiveStatus } from './liveSocket'

/**
 * Live per-resource overlay for one device - {resource: {value, mode,
 * valueAuto, valueManual, timestamp}} - patched in as events arrive over
 * the shared WebSocket (apps/messaging-gateway, AGENTS.md section 9), on
 * top of whatever a page already loaded via the REST API. Cleared whenever
 * `deviceId` changes.
 */
export function useDeviceLiveState(deviceId) {
  const [live, setLive] = useState({})

  useEffect(() => {
    setLive({})
    return subscribeToLiveEvents(({ event }) => {
      if (event.domain !== 'device' || String(event.entityId) !== String(deviceId)) return
      setLive((prev) => ({
        ...prev,
        [event.resource]: {
          value: event.value,
          mode: event.mode,
          valueAuto: event.valueAuto,
          valueManual: event.valueManual,
          timestamp: event.timestamp,
        },
      }))
    })
  }, [deviceId])

  return live
}

/** Whether the shared live WebSocket is currently connected - for a small "Live" indicator. */
export function useLiveConnectionStatus() {
  const [status, setStatus] = useState(false)
  useEffect(() => subscribeToLiveStatus(setStatus), [])
  return status
}
