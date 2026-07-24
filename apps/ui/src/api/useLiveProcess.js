import { useEffect, useState } from 'react'
import { subscribeToLiveEvents } from './liveSocket'

/**
 * Live per-process overlay - {status, critical, warning, metrics} - patched
 * in as events arrive over the shared WebSocket (apps/messaging-gateway,
 * AGENTS.md section 9/10/21), on top of whatever a page already loaded via
 * REST. Subscribes once, keyed by every process's own id - same reasoning
 * as useDeviceLiveState (apps/ui/src/api/useLiveDevice.js): avoids a
 * setState-in-effect reset and keeps one shared listener regardless of how
 * many process rows are on screen. `metrics` is the one field here that
 * publishes on every orchestrator tick rather than only on an actual
 * change (AGENTS.md section 21) - everything else in this overlay is
 * edge-triggered.
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
