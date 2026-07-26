import React, { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import BuzzerIndicator from '../../components/indicators/BuzzerIndicator'

/**
 * Expandable-row detail for the "active-buzzer" process kind (AGENTS.md's
 * Active Zummer section) - no config to edit here (unlike Temperature
 * Control's min/max), the beep policy lives entirely in Processes ->
 * Settings -> Message Levels, shared across every future sound-output
 * process. Just a live visualization of the buzzer's currently commanded
 * state, via the same shared BuzzerIndicator atom the notification-center
 * work built ahead of time for this (AGENTS.md section 26).
 */
const ActiveBuzzerPanel = ({ process }) => {
  const [device, setDevice] = useState(null)
  const live = useDeviceLiveState(process.device_id)

  useEffect(() => {
    if (process.device_id == null) return
    api
      .getDevice(process.device_id)
      .then(setDevice)
      .catch(() => setDevice(null))
  }, [process.device_id])

  if (!device) return null

  const active = (live.Buzzer ? live.Buzzer.value : device.resources?.Buzzer?.value) === true

  return (
    <div className="p-3 pt-0 d-flex align-items-center gap-3">
      <BuzzerIndicator active={active} />
      <div className="text-body-secondary small">
        Beep pattern is set per WEM level in Processes -&gt; Settings -&gt; Message Levels.
      </div>
    </div>
  )
}

export default ActiveBuzzerPanel
