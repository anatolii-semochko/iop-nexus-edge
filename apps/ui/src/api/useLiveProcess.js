import { useEffect, useState } from 'react'
import { subscribeToLiveEvents } from './liveSocket'

/**
 * Live per-process overlay - {status, critical} - patched in as events
 * arrive over the shared WebSocket (apps/messaging-gateway, AGENTS.md
 * section 9/10), on top of whatever a page already loaded via REST.
 * Subscribes once, keyed by every process's own id - same reasoning as
 * useDeviceLiveState (apps/ui/src/api/useLiveDevice.js): avoids a
 * setState-in-effect reset and keeps one shared listener regardless of how
 * many process rows are on screen.
 */
export function useProcessLiveState(processId) {
  const [byProcess, setByProcess] = useState({})

  useEffect(
    () =>
      subscribeToLiveEvents(({ event }) => {
        if (event.domain !== 'process') return
        setByProcess((prev) => ({
          ...prev,
          [event.entityId]: { ...prev[event.entityId], [event.field]: event.value },
        }))
      }),
    [],
  )

  return byProcess[processId] ?? {}
}
