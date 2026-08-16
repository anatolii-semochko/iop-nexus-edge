import React from 'react'
import { CCol, CRow } from '@coreui/react'
import { api } from '../../api/client'
import { useProcessLiveState } from '../../api/useLiveProcess'
import { wemBadgeClass } from '../../utils/wem'
import NumericStepper from '../devices/NumericStepper'

// Two-sided (min AND max both matter for an enclosure reading, unlike
// ResourceMonitorPanel.jsx's ceiling-only CPU/RAM/disk/temp) - error zone
// is outside [min, max], warning zone is outside the (wider)
// [warnMin, warnMax]. `humidityRow` only rendered when this process
// instance actually has a humidity device configured (AGENTS_TO_DO.md,
// 2026-08-09 "НОДА КОНТРОЛЮ" - a DS18B20-only bring-up instance has none).
const METRIC_ROWS = [
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    minKey: 'envTempMin',
    maxKey: 'envTempMax',
    warnMinKey: 'envTempWarnMin',
    warnMaxKey: 'envTempWarnMax',
    stepperMin: -40,
    stepperMax: 100,
  },
  {
    key: 'humidity',
    label: 'Humidity',
    unit: '%RH',
    minKey: 'envHumidityMin',
    maxKey: 'envHumidityMax',
    warnMinKey: 'envHumidityWarnMin',
    warnMaxKey: 'envHumidityWarnMax',
    stepperMin: 0,
    stepperMax: 100,
  },
]

// Undefined bound = that side unenforced (AGENTS_TO_DO.md 2026-08-09) -
// deliberately not the "0 disables" convention ResourceMonitorPanel.jsx
// uses for its own percentages, since 0 is a real, meaningful threshold
// for a temperature min.
const zoneFor = (value, min, max, warnMin, warnMax) => {
  if (value === undefined) return 'normal'
  if ((min !== undefined && value < min) || (max !== undefined && value > max)) return 'error'
  if ((warnMin !== undefined && value < warnMin) || (warnMax !== undefined && value > warnMax)) return 'warning'
  return 'normal'
}

/**
 * Expandable-row detail for the "control-node" process kind
 * (AGENTS_TO_DO.md, 2026-08-09 "НОДА КОНТРОЛЮ") - enclosure temperature/
 * humidity, same live-metrics-over-WebSocket + config-driven-thresholds
 * shape as ResourceMonitorPanel.jsx (section 21), just two-sided (a min
 * AND a max both matter here) instead of ceiling-only, and without that
 * panel's own rolling chart (not asked for here). Four thresholds per
 * metric - Warning Min/Max and Error Min/Max - all writing to the
 * process's own config via the same generic `PATCH /processes/:id/config`
 * every other kind's config already uses.
 *
 * This process kind's *runner* lives in nexus-edge-aquarium's own
 * plugins/control-node/process.ts (not nexus-edge core) - same split
 * temperature-control already established (AGENTS_TO_DO.md, 2026-07-29
 * "chistiy proekt"): the device/node *types* stay in core's public
 * Library, a target project owns the real instance's behavior, but this
 * *panel* stays here in core's KIND_PANELS, matching temperature-control's
 * own TemperatureProcessPanel.jsx precedent exactly.
 */
const ControlNodePanel = ({ process, onConfigChange }) => {
  const live = useProcessLiveState(process.id)
  const metrics = live.metrics ?? process.metrics
  const hasHumidity = process.config.humidityDeviceId !== undefined && process.config.humidityDeviceId !== null

  const handleCommit = async (field, value) => {
    const result = await api.setProcessConfig(process.id, { [field]: value })
    onConfigChange(result.config)
  }

  const rows = METRIC_ROWS.filter((row) => row.key !== 'humidity' || hasHumidity)

  return (
    <div className="p-3 pt-0">
      {rows.map(({ key, label, unit, minKey, maxKey, warnMinKey, warnMaxKey, stepperMin, stepperMax }) => {
        const value = metrics?.[key]
        const min = process.config[minKey]
        const max = process.config[maxKey]
        const warnMin = process.config[warnMinKey]
        const warnMax = process.config[warnMaxKey]
        const zone = zoneFor(value, min, max, warnMin, warnMax)
        return (
          <CRow key={key} className="align-items-center g-4 mb-2">
            <CCol xs="auto" style={{ width: '9rem' }}>
              <div className="text-body-secondary small">{label}</div>
              <div
                className={`d-inline-block ${zone === 'normal' ? '' : `${wemBadgeClass(zone)} px-2`}`}
                style={{ fontSize: '1.9rem', fontWeight: 600, lineHeight: 1, whiteSpace: 'nowrap' }}
              >
                {value !== undefined ? `${value.toFixed(1)}${unit}` : '-'}
              </div>
            </CCol>
            <CCol xs="auto">
              <div className="text-body-secondary small">Warning Min{unit}</div>
              <NumericStepper
                value={warnMin ?? stepperMin}
                step={1}
                min={stepperMin}
                max={stepperMax}
                onCommit={(v) => handleCommit(warnMinKey, v)}
              />
            </CCol>
            <CCol xs="auto">
              <div className="text-body-secondary small">Warning Max{unit}</div>
              <NumericStepper
                value={warnMax ?? stepperMax}
                step={1}
                min={stepperMin}
                max={stepperMax}
                onCommit={(v) => handleCommit(warnMaxKey, v)}
              />
            </CCol>
            <CCol xs="auto">
              <div className="text-body-secondary small">Error Min{unit}</div>
              <NumericStepper
                value={min ?? stepperMin}
                step={1}
                min={stepperMin}
                max={stepperMax}
                onCommit={(v) => handleCommit(minKey, v)}
              />
            </CCol>
            <CCol xs="auto">
              <div className="text-body-secondary small">Error Max{unit}</div>
              <NumericStepper
                value={max ?? stepperMax}
                step={1}
                min={stepperMin}
                max={stepperMax}
                onCommit={(v) => handleCommit(maxKey, v)}
              />
            </CCol>
          </CRow>
        )
      })}
    </div>
  )
}

export default ControlNodePanel
