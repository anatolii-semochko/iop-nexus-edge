import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CAlert, CBadge, CCard, CCardBody, CCardHeader, CSpinner } from '@coreui/react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import LiveBadge from './LiveBadge'
import LightRegulatorControl from 'devices/standalone/light-regulator/ui/control/LightRegulatorControl.jsx'
import ActiveBuzzerControl from 'devices/standalone/active-buzzer/ui/control/ActiveBuzzerControl.jsx'

// device.type -> its own ui/control component (AGENTS.md section 7) - a
// Device is atomic (to-do.txt's 2026-07-27 Device/Node refactor), so this
// is a flat map now, not nested by resource name. Same pattern as
// DEVICE_TYPE_SIMULATORS in DevSimulator.jsx.
const DEVICE_TYPE_CONTROLS = {
  'light-regulator': LightRegulatorControl,
  'active-buzzer': ActiveBuzzerControl,
}

const formatValue = (value, units) => {
  if (value === null || value === undefined) return '-'
  return units ? `${value} ${units}` : String(value)
}

const modeColor = (mode) => (mode === 'MANUAL' ? 'warning' : 'success')

/**
 * Production-style device view: read-only current state. Generic (not
 * device-specific) by default - see AGENTS.md section 7 for the
 * per-device-type ui/control component this is a stand-in for, used
 * instead wherever a device type has one (see DEVICE_TYPE_CONTROLS). A
 * Device has exactly one value now, not a table of resources.
 */
const DeviceDetail = () => {
  const { id } = useParams()
  const [device, setDevice] = useState(null)
  const [error, setError] = useState(null)
  const live = useDeviceLiveState(id)

  useEffect(() => {
    api
      .getDevice(id)
      .then(setDevice)
      .catch((err) => setError(err.message))
  }, [id])

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!device) return <CSpinner color="primary" />

  // Live overlay (WebSocket) wins over the value from the initial REST
  // load, but keeps that load's units/valueType - the live envelope
  // doesn't carry those (AGENTS.md section 9).
  const value = live.value !== undefined ? live.value : device.value
  // No fallback to "AUTO" - a readOnly (sensor) device has no Dual Devices
  // Model mode at all (AGENTS.md section 6/7).
  const mode = live.mode ?? device.dualState?.mode
  const CustomControl = DEVICE_TYPE_CONTROLS[device.type]

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>{device.name}</strong> <small>{device.type}</small>{' '}
        <CBadge color={device.backend === 'physical' ? 'primary' : 'info'}>{device.backend}</CBadge>{' '}
        <LiveBadge />
      </CCardHeader>
      <CCardBody className="d-flex align-items-center gap-3">
        {CustomControl ? (
          <CustomControl
            value={value}
            min={device.capabilities?.min}
            max={device.capabilities?.max}
          />
        ) : (
          <div style={{ fontSize: '1.5rem' }}>{formatValue(value, device.units)}</div>
        )}
        {mode ? (
          <CBadge color={modeColor(mode)}>{mode}</CBadge>
        ) : (
          <span className="text-body-secondary">&mdash;</span>
        )}
      </CCardBody>
    </CCard>
  )
}

export default DeviceDetail
