import { useEffect, useState } from 'react'
import { subscribeToLiveEvents } from './liveSocket'

/**
 * Live overlay for every node at once - {[id]: <the row GET /nodes would
 * return for it>}, patched in as events arrive over the shared WebSocket
 * (apps/messaging-gateway, AGENTS.md section 61). Fleet-wide, not a
 * per-id selector like useDeviceLiveState - NodesList.jsx renders its
 * rows from one flat array (no per-row component to subscribe
 * individually the way DevicesList.jsx's DeviceRow does), so the whole
 * map is spread over that array's rows instead.
 *
 * Unlike device's envelope (flat top-level value/mode/valueAuto/
 * valueManual), a node's envelope nests everything under `value` -
 * NodeEventEnvelope carries the whole live-ish row rather than a
 * hand-picked field subset (messaging.ts), so the overlay here is just
 * `event.value` as-is, no field-by-field reconstruction.
 */
export function useNodesLiveState() {
  const [byNode, setByNode] = useState({})

  useEffect(
    () =>
      subscribeToLiveEvents(({ event }) => {
        if (event.domain !== 'node') return
        setByNode((prev) => ({ ...prev, [event.entityId]: event.value }))
      }),
    [],
  )

  return byNode
}
