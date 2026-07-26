import { useEffect, useState } from 'react'
import { subscribeToLiveEvents } from './liveSocket'

/**
 * Live state for every process at once - {[id]: {status, critical,
 * warning, metrics, messages, dashboardFlaggedAt}} - patched in as events
 * arrive over the shared WebSocket (apps/messaging-gateway). AGENTS.md
 * section 24: every message on `event.domain === 'process'` is a full
 * fleet-wide snapshot (`event.processes`, one entry per process), so a
 * *single* incoming event replaces every process's entry in one pass, not
 * one field on one process at a time the way the retired per-field scheme
 * did. `useProcessLiveState` below is the common per-row case; this one is
 * for a caller that needs to look across every process at once (Dashboard
 * tab eligibility - see DashboardTab.jsx) rather than one row's own
 * overlay.
 *
 * Cadence note: `metrics`/`status`/`dashboardFlaggedAt` only refresh on the
 * broadcast's own timer (`PROCESS_STATE_BROADCAST_INTERVAL_MS`, default 5s
 * - not the orchestrator's 1s compute tick) unless a `critical`/`warning`/
 * new-message change on *some* process piggybacks an urgent broadcast
 * sooner - a resource-monitor panel's live chart samples at that same
 * cadence now, not every second.
 */
export function useProcessesLiveState() {
  const [byProcess, setByProcess] = useState({})

  useEffect(
    () =>
      subscribeToLiveEvents(({ event }) => {
        if (event.domain !== 'process' || event.eventType !== 'snapshot') return
        setByProcess((prev) => {
          const next = { ...prev }
          for (const entry of event.processes) {
            next[entry.id] = entry
          }
          return next
        })
      }),
    [],
  )

  return byProcess
}

/** One process's own slice of useProcessesLiveState above - the common
 * per-row case (ProcessesTable.jsx's ProcessRow, ResourceMonitorPanel.jsx). */
export function useProcessLiveState(processId) {
  return useProcessesLiveState()[processId] ?? {}
}
