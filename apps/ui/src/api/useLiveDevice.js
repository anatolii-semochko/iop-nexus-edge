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
        // AGENTS_TO_DO.md, 2026-08-23 - a metadata-only event (rename/
        // group/node reassignment/simulated/capabilities, see
        // useDevicesMetadataLiveState below) carries no reading at all
        // (`value` absent, section 61's messaging.ts comment on why it's
        // optional now). Merge onto the previous entry rather than
        // replacing it outright - unconditionally overwriting `value`
        // with `undefined` on every event used to silently clobber the
        // last known live reading whenever an unrelated metadata change
        // arrived for the same device.
        setByDevice((prev) => {
          const previous = prev[event.entityId] ?? {}
          const next = { ...previous }
          if ('value' in event) {
            next.value = event.value
            next.timestamp = event.timestamp
            // Every one of these is itself sparse - present only on the
            // specific write path that actually has it (mode/valueAuto/
            // valueManual: dualDevicesModel's own publishState, Dual
            // Devices Model writes only; isOverdue/expiresAt: AGENTS.md
            // section 62, only when that status itself changed). A plain
            // EdgeX reading republish (routes/devices.ts's own "device-read"
            // origin, fired on every GET /devices/:id, including EdgeX's
            // own AutoEvents-driven readback) carries none of them -
            // confirmed live 2026-08-29: it interleaves with a writable
            // device's own AUTO-mode publishState roughly every tick,
            // and unconditionally overwriting these with `event.field`
            // (almost always `undefined` on THIS event type) made `mode`
            // flicker between the live AUTO value and DevicesList.jsx's
            // own stale one-time-fetched dualState.mode every second -
            // once per "device-read" event, once per real write. Guarding
            // each field on its own presence keeps the last known good
            // value instead of clobbering it with a sibling event's gap.
            if ('mode' in event) next.mode = event.mode
            if ('valueAuto' in event) next.valueAuto = event.valueAuto
            if ('valueManual' in event) next.valueManual = event.valueManual
            if ('isOverdue' in event) next.isOverdue = event.isOverdue
            if ('expiresAt' in event) next.expiresAt = event.expiresAt
          }
          return { ...prev, [event.entityId]: next }
        })
      }),
    [],
  )

  return byDevice[deviceId] ?? {}
}

/**
 * Fleet-wide metadata overlay - {[id]: <the list-row GET /devices would
 * return for it>} (AGENTS_TO_DO.md, 2026-08-23) - mirrors useNodesLiveState
 * (section 61)'s own fleet-wide shape, for DevicesList.jsx's own use: it
 * renders from one flat array, not a per-row component subscribing
 * individually, so a per-id selector like useDeviceLiveState above isn't
 * the right shape here. Only ever populated by a metadata event
 * (routes/devices.ts's publishDeviceMetadata, on rename/group/node
 * reassignment/simulated/capabilities) - a plain reading-value event
 * never sets `event.metadata` at all.
 */
export function useDevicesMetadataLiveState() {
  const [byDevice, setByDevice] = useState({})

  useEffect(
    () =>
      subscribeToLiveEvents(({ event }) => {
        if (event.domain !== 'device' || event.metadata === undefined) return
        setByDevice((prev) => ({ ...prev, [event.entityId]: event.metadata }))
      }),
    [],
  )

  return byDevice
}

/** Whether the shared live WebSocket is currently connected - for a small "Live" indicator. */
export function useLiveConnectionStatus() {
  const [status, setStatus] = useState(false)
  useEffect(() => subscribeToLiveStatus(setStatus), [])
  return status
}
