import React, { useEffect, useState } from 'react'
import { CCol, CRow } from '@coreui/react'
import { api } from '../../api/client'
import { useProcessLiveState } from '../../api/useLiveProcess'
import { wemBadgeClass } from '../../utils/wem'
import NumericStepper from '../devices/NumericStepper'
import ResourceLevelsChart, { MAX_SAMPLES, ResourceLevelsChartLegend } from './ResourceLevelsChart'

const METRIC_ROWS = [
  { key: 'cpu', warnKey: 'cpuWarnMax', maxKey: 'cpuMax', label: 'CPU' },
  { key: 'ram', warnKey: 'ramWarnMax', maxKey: 'ramMax', label: 'RAM' },
  { key: 'disk', warnKey: 'diskWarnMax', maxKey: 'diskMax', label: 'Disk' },
]

// A threshold of 0 (or unset) disables that check - same rule as the
// orchestrator's own `exceeds()` (resourceMonitor.ts, AGENTS.md section
// 21). Purely a display concern: this only decides which badge colors
// *this one metric's* current-value chip, independent of the row-level
// critical/warning flags the orchestrator computes for the whole process.
const zoneFor = (value, warnMax, errorMax) => {
  if (value === undefined) return 'normal'
  if (errorMax && value > errorMax) return 'error'
  if (warnMax && value > warnMax) return 'warning'
  return 'normal'
}

/**
 * Expandable-row detail for the "resource-monitor" process kind (AGENTS.md
 * section 21) - host CPU/RAM/disk load, three rows sharing one panel (one
 * permanent process with three metrics, not three separate processes).
 * Two thresholds per metric (percentages, both writing to the process's own
 * config via PATCH /processes/:id/config, same as TemperatureProcessPanel's
 * min/max) - Warning Max% (cpuWarnMax/ramWarnMax/diskWarnMax) and Error
 * Max% (cpuMax/ramMax/diskMax), reusing NumericStepper as the +/- control
 * for both.
 *
 * Live % values arrive over the shared WebSocket feed (useProcessLiveState,
 * same as status/critical/warning elsewhere - AGENTS.md section 24), not a
 * per-panel HTTP poll. Samples at the fleet-wide broadcast's own cadence
 * (`PROCESS_STATE_BROADCAST_INTERVAL_MS`, default 5s) rather than the
 * orchestrator's 1s compute tick - a metrics-only change isn't one of the
 * urgent triggers (AGENTS.md section 24), so this chart's resolution is
 * coarser than it was before that section's rework. Each incoming event
 * also feeds a rolling
 * MAX_SAMPLES-long history buffer for ResourceLevelsChart - there's no
 * server-side history endpoint, this is purely "what we've personally
 * observed since opening this panel", which resets to empty every time
 * it's re-expanded (matching the user's own framing: "дані приходять,
 * коли компонента відкрита").
 */
const ResourceMonitorPanel = ({ process, onConfigChange }) => {
  const live = useProcessLiveState(process.id)
  const metrics = live.metrics ?? process.metrics
  const [history, setHistory] = useState(() => (process.metrics ? [process.metrics] : []))

  // Resets the window on (re-)mount only - a panel only mounts once per
  // expand, so this never fires again for the same expand/collapse cycle.
  useEffect(() => {
    setHistory(process.metrics ? [process.metrics] : [])
    // process.metrics deliberately excluded - only process.id identifies a
    // genuinely new mount here, not every list refetch's new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process.id])

  // Appends each live event as it arrives - separate from the reset above
  // so a re-render from an unrelated prop change (e.g. config edits
  // elsewhere on the row) never resets history mid-flight.
  useEffect(() => {
    if (!live.metrics) return
    setHistory((prev) => [...prev, live.metrics].slice(-MAX_SAMPLES))
  }, [live.metrics])

  const handleCommit = async (field, value) => {
    const result = await api.setProcessConfig(process.id, { [field]: value })
    onConfigChange(result.config)
  }

  return (
    <div className="p-3 pt-0 d-flex align-items-stretch gap-4">
      <div>
        {METRIC_ROWS.map(({ key, warnKey, maxKey, label }) => {
          const value = metrics?.[key]
          const zone = zoneFor(value, process.config[warnKey], process.config[maxKey])
          return (
            <CRow key={key} className="align-items-center g-4 mb-2">
              <CCol xs="auto" style={{ width: '6.5rem' }}>
                <div className="text-body-secondary small">{label}</div>
                <div
                  className={`text-black d-inline-block ${zone === 'normal' ? '' : `${wemBadgeClass(zone)} px-2`}`}
                  style={{
                    fontSize: '1.9rem',
                    fontWeight: 600,
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {value !== undefined ? `${value.toFixed(1)}%` : '-'}
                </div>
              </CCol>
              <CCol xs="auto">
                <div className="text-body-secondary small">Warning Max%</div>
                <NumericStepper
                  value={process.config[warnKey] ?? 0}
                  step={1}
                  min={0}
                  max={100}
                  onCommit={(v) => handleCommit(warnKey, v)}
                />
              </CCol>
              <CCol xs="auto">
                <div className="text-body-secondary small">Error Max%</div>
                <NumericStepper
                  value={process.config[maxKey] ?? 0}
                  step={1}
                  min={0}
                  max={100}
                  onCommit={(v) => handleCommit(maxKey, v)}
                />
              </CCol>
            </CRow>
          )
        })}
      </div>
      <div className="flex-grow-1 d-flex flex-column mb-2">
        <ResourceLevelsChartLegend />
        <div className="flex-grow-1 position-relative">
          <ResourceLevelsChart history={history} />
        </div>
      </div>
    </div>
  )
}

export default ResourceMonitorPanel
