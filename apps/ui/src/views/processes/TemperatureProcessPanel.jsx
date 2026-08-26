import React, { useEffect, useState } from 'react'
import { CCol, CRow } from '@coreui/react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import StatusIndicator from '../../components/indicators/StatusIndicator'
import NumericStepper from '../devices/NumericStepper'

// Label wrapper stays local - StatusIndicator itself is the elementary
// visual primitive (just the light), not aware of what it's labeling.
const LabeledIndicator = ({ active, color, label }) => (
  <div className="text-center">
    <div className="text-body-secondary small">{label}</div>
    <StatusIndicator active={active} color={color} />
  </div>
)

/**
 * Expandable-row detail for a "temperature-control"/"temperature-monitor"
 * process (AGENTS.md section 10) - shared by both since they look
 * identical, only their table-row actions differ. Min/Max write to the
 * process's own config (Postgres, via PATCH /processes/:id/config), not a
 * device - reuses NumericStepper (apps/ui/src/views/devices/
 * NumericStepper.jsx) purely as the +/- input control, same as the
 * Temperature override in Dev Simulator.
 *
 * The sensor and its two actuators are three separate atomic Devices on
 * the same Node now (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor) -
 * `process.config`'s sensorDeviceId/heaterDeviceId/coolerDeviceId is the
 * role -> deviceId mapping this panel reads, not a single `process.
 * device_id` with three named resources.
 */
const TemperatureProcessPanel = ({ process, onConfigChange }) => {
  const { sensorDeviceId, heaterDeviceId, coolerDeviceId } = process.config
  const [sensor, setSensor] = useState(null)
  const [heater, setHeater] = useState(null)
  const [cooler, setCooler] = useState(null)
  const liveSensor = useDeviceLiveState(sensorDeviceId)
  const liveHeater = useDeviceLiveState(heaterDeviceId)
  const liveCooler = useDeviceLiveState(coolerDeviceId)

  useEffect(() => {
    if (sensorDeviceId == null) return
    api
      .getDevice(sensorDeviceId)
      .then(setSensor)
      .catch(() => setSensor(null))
  }, [sensorDeviceId])
  useEffect(() => {
    if (heaterDeviceId == null) return
    api
      .getDevice(heaterDeviceId)
      .then(setHeater)
      .catch(() => setHeater(null))
  }, [heaterDeviceId])
  useEffect(() => {
    if (coolerDeviceId == null) return
    api
      .getDevice(coolerDeviceId)
      .then(setCooler)
      .catch(() => setCooler(null))
  }, [coolerDeviceId])

  const handleCommit = async (field, value) => {
    // max cannot be less than min (AGENTS.md section 10) - checked
    // client-side too so an invalid pair never even reaches the API.
    if (field === 'min' && process.config.max !== undefined && value > process.config.max) return
    if (field === 'max' && process.config.min !== undefined && value < process.config.min) return
    const result = await api.setProcessConfig(process.id, { [field]: value })
    onConfigChange(result.config)
  }

  if (!sensor || !heater || !cooler) return null

  const temperature = liveSensor.value !== undefined ? liveSensor.value : sensor.value
  const coolerActive = (liveCooler.value !== undefined ? liveCooler.value : cooler.value) === true
  const heaterActive = (liveHeater.value !== undefined ? liveHeater.value : heater.value) === true

  return (
    <div className="pt-0 pb-3 px-2">
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
          <LabeledIndicator active={coolerActive} color="#3b82f6" label="Cooler" />
        </CCol>
        <CCol xs="auto">
          <LabeledIndicator active={heaterActive} color="#dc3545" label="Heater" />
        </CCol>
      </CRow>
    </div>
  )
}

export default TemperatureProcessPanel
