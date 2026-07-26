import React, { useState } from 'react'
import { CAlert } from '@coreui/react'
import { api } from '../../api/client'
import Switch from '../../components/Switch'

/**
 * Expandable-row detail for the "heartbeat-control-test" process kind
 * (AGENTS.md's Heartbeating Control section) - a dummy PERMANENT process
 * (not controllable) whose only job is letting "Heartbeating Control"'s
 * escalation be exercised on demand. The switch here toggles this
 * process's own bespoke internal `heartbeatTestSimulateFailure` flag, NOT
 * the generic process ON/OFF action - an earlier draft used that instead
 * and it visibly lagged (that field is a deliberately non-urgent,
 * timer-only broadcast value). Managed with local optimistic state
 * instead: the switch reflects the click immediately, never waiting on
 * any broadcast/reload to catch up.
 */
const HeartbeatControlTestPanel = ({ process }) => {
  const [simulateFailure, setSimulateFailure] = useState(
    process.heartbeatTestSimulateFailure ?? false,
  )
  const [error, setError] = useState(null)

  const handleToggle = async (nextSimulateFailure) => {
    setSimulateFailure(nextSimulateFailure)
    setError(null)
    try {
      await api.setHeartbeatTestFailure(process.id, nextSimulateFailure)
    } catch (err) {
      setSimulateFailure(!nextSimulateFailure)
      setError(err.message)
    }
  }

  return (
    <div className="p-3 pt-0">
      {error && <CAlert color="danger">{error}</CAlert>}
      <div className="d-flex align-items-center gap-3">
        <Switch
          checked={!simulateFailure}
          onChange={(next) => handleToggle(!next)}
          ariaLabel="Simulate heartbeat failure"
        />
        <div className="text-body-secondary small">
          Turn this OFF to simulate a dead heartbeat - its runner throws every tick while off, so it
          stops appearing in the fleet&apos;s heartbeat batch just like a genuinely broken process
          would. Watch the &quot;Heartbeating Control&quot; process&apos;s own row: a warning
          appears after 3 skipped ticks, an error after 10 - both auto-resolve the moment this is
          switched back on. Its heartbeat <em>monitoring</em> can also be paused independently from
          the &quot;Heartbeating Control&quot; panel&apos;s own list (this is the only process
          seeded as stoppable), which tests that separate mechanism instead.
        </div>
      </div>
    </div>
  )
}

export default HeartbeatControlTestPanel
