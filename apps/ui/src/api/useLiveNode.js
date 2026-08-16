import { useEffect, useState } from 'react'
import { api } from './client'
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

/**
 * True whenever at least one node in the whole system is currently
 * simulated (AGENTS_TO_DO.md, 2026-08-16) - the header's own blinking
 * "Simulation" badge (AppHeader.jsx), mounted app-wide, not just on the
 * Nodes page. One own `GET /nodes` fetch on mount (this hook has no other
 * source for the fleet - NodesList.jsx's own state isn't reachable from
 * here) layered with the exact same live `node` overlay useNodesLiveState
 * already provides, so a `simulated` toggle in any tab, on any page,
 * updates this immediately - the underlying WebSocket connection is
 * shared app-wide regardless of which page happens to be mounted.
 */
export function useAnyNodeSimulated() {
  const [nodes, setNodes] = useState([])
  const liveNodes = useNodesLiveState()

  useEffect(() => {
    api.listNodes().then(setNodes).catch(() => {})
  }, [])

  return nodes.some((node) => (liveNodes[node.id]?.simulated ?? node.simulated) === true)
}
