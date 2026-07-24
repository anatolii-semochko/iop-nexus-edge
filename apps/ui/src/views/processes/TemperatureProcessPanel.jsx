import React, { useEffect, useState } from 'react'
import { CCol, CRow } from '@coreui/react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import NumericStepper from '../devices/NumericStepper'

const Indicator = ({ active, color, label }) => (
  <div className="text-center">
    <div className="text-body-secondary small">{label}</div>
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        margin: '0 auto',
        backgroundColor: active ? color : '#adb5bd',
      }}
    />
  </div>
)

/**
 * Expandable-row detail for a "temperature-control"/"temperature-monitor"
 * process (AGENTS.md section 10) - shared by both since they look
 * identical, only their table-row actions differ. Min/Max write to the
 * process's own config (Postgres, via PATCH /processes/:id/config), not a
 * device resource - reuses NumericStepper (apps/ui/src/views/devices/
 * NumericStepper.jsx) purely as the +/- input control, same as the
 * Temperature override in Dev Simulator.
 */
const TemperatureProcessPanel = ({ process, onConfigChange }) => {
  const [device, setDevice] = useState(null)
  const live = useDeviceLiveState(process.device_id)

  useEffect(() => {
    if (process.device_id == null) return
    api
      .getDevice(process.device_id)
      .then(setDevice)
      .catch(() => setDevice(null))
  }, [process.device_id])

  const handleCommit = async (field, value) => {
    // max cannot be less than min (AGENTS.md section 10) - checked
    // client-side too so an invalid pair never even reaches the API.
    if (field === 'min' && process.config.max !== undefined && value > process.config.max) return
    if (field === 'max' && process.config.min !== undefined && value < process.config.min) return
    const result = await api.setProcessConfig(process.id, { [field]: value })
    onConfigChange(result.config)
  }

  if (!device) return null

  const temperature = live.Temperature
    ? live.Temperature.value
    : device.resources?.Temperature?.value
  const coolerActive = (live.Cooler ? live.Cooler.value : device.resources?.Cooler?.value) === true
  const heaterActive = (live.Heater ? live.Heater.value : device.resources?.Heater?.value) === true

  return (
    <div className="p-3 pt-0">
      <CRow className="align-items-center g-4">
        <CCol xs="auto">
          <div className="text-body-secondary small">Min</div>
          <NumericStepper
            value={process.config.min ?? 0}
            step={0.5}
            onCommit={(v) => handleCommit('min', v)}
          />
        </CCol>
        <CCol xs="auto">
          <div className="text-body-secondary small">Max</div>
          <NumericStepper
            value={process.config.max ?? 0}
            step={0.5}
            onCommit={(v) => handleCommit('max', v)}
          />
        </CCol>
        <CCol xs="auto" className="text-center">
          <div className="text-body-secondary small">Temperature</div>
          <div style={{ fontSize: '2.5rem', fontWeight: 600, lineHeight: 1 }}>
            {temperature !== undefined ? Number(temperature).toFixed(1) : '-'}
          </div>
        </CCol>
        <CCol xs="auto">
          <Indicator active={coolerActive} color="#3b82f6" label="Cooler" />
        </CCol>
        <CCol xs="auto">
          <Indicator active={heaterActive} color="#dc3545" label="Heater" />
        </CCol>
      </CRow>
    </div>
  )
}

export default TemperatureProcessPanel
