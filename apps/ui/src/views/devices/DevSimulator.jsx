import React, { useEffect, useRef, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CFormCheck,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
  CToast,
  CToastBody,
  CToastClose,
  CToaster,
} from '@coreui/react'
import { api } from '../../api/client'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import LiveBadge from './LiveBadge'
import NumericStepper from './NumericStepper'
import { deviceSimulators } from '../../deviceTypeRegistry'

// How long to wait after the last slider move before actually sending it -
// dragging a range input fires onChange on every pixel step; without this,
// every one of those would hit the API and the message bus.
const SLIDER_DEBOUNCE_MS = 150

const modeColor = (mode) => {
  switch (mode) {
    case 'MANUAL':
      return 'warning'
    case 'SERVICE':
      return 'info'
    default:
      return 'success'
  }
}

/**
 * One virtual device's row: current/auto value and a control to override
 * it - writes through Devices API -> EdgeX core-command, handled by the
 * Virtual Node Runtime (AGENTS.md section 6). Generic stand-in for the
 * per-device-type dev/ui simulator (AGENTS.md section 7), except for a
 * device type with its own component (see deviceSimulators,
 * deviceTypeRegistry.js).
 */
const DeviceSimulatorRow = ({ device, onError }) => {
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(false)
  const live = useDeviceLiveState(device.id)
  const debounceTimer = useRef(null)

  const load = () => {
    api
      .getDevice(device.id)
      .then(setDetail)
      .catch((err) => onError(err.message))
  }

  useEffect(load, [device.id, onError])
  useEffect(() => () => clearTimeout(debounceTimer.current), [])

  // Actuator devices (Bool checkboxes, numeric commits): a UI write is
  // always a manual override (Dual Devices Model MANUAL - AGENTS.md
  // section 6), applied instantly, no separate "Set" step.
  const handleWrite = async (value) => {
    setBusy(true)
    try {
      await api.writeDevice(device.id, value)
      load()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Read-only sensor devices: no Dual Devices Model, no "Set" step either -
  // the slider (or other simulator control) itself is the input, debounced
  // so dragging doesn't flood the API/bus with every intermediate position.
  const handleSimulate = (value) => {
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(async () => {
      try {
        await api.simulateDevice(device.id, value)
        load()
      } catch (err) {
        onError(err.message)
      }
    }, SLIDER_DEBOUNCE_MS)
  }

  const handleAuto = async () => {
    setBusy(true)
    try {
      await api.releaseDevice(device.id)
      load()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!detail) {
    return (
      <CTableRow>
        <CTableDataCell>{device.name}</CTableDataCell>
        <CTableDataCell colSpan={5}>
          <CSpinner size="sm" />
        </CTableDataCell>
      </CTableRow>
    )
  }

  const currentValue = live.value !== undefined ? live.value : detail.value
  // No fallback to "AUTO" - a readOnly (sensor) device has no Dual Devices
  // Model mode at all (AGENTS.md section 6/7).
  const mode = live.mode ?? detail.dualState?.mode
  const autoValue = detail.capabilities?.readOnly
    ? undefined
    : (live.valueAuto ?? detail.dualState?.valueAuto)
  const mismatch = autoValue !== undefined && String(autoValue) !== String(currentValue)
  const CustomSimulator = deviceSimulators[detail.type]

  return (
    <CTableRow>
      <CTableDataCell>{detail.name}</CTableDataCell>
      <CTableDataCell className={mismatch ? 'text-danger' : undefined}>
        {currentValue !== undefined ? String(currentValue) : '-'}
      </CTableDataCell>
      <CTableDataCell className={mismatch ? 'text-danger' : undefined}>
        {autoValue !== undefined ? String(autoValue) : '-'}
      </CTableDataCell>
      <CTableDataCell>
        {mode ? (
          <CBadge color={modeColor(mode)}>{mode}</CBadge>
        ) : (
          <span className="text-body-secondary">&mdash;</span>
        )}
      </CTableDataCell>
      <CTableDataCell>
        {CustomSimulator ? (
          // Same readOnly branch the generic NumericStepper path below
          // already uses - a writable (non-readOnly) device's `.../simulate`
          // call is rejected server-side (400 "not read-only", routes/
          // devices.ts) - previously always `handleSimulate` here
          // regardless, which happened to work only because the one prior
          // CustomSimulator (light-regulator) is readOnly. Surfaced live
          // 2026-08-09 registering LedSimulator/ActiveBuzzerSimulator for
          // the (non-readOnly) `led`/`active-buzzer` types.
          <CustomSimulator
            value={currentValue}
            min={detail.capabilities?.min}
            max={detail.capabilities?.max}
            step={detail.capabilities?.step}
            color={detail.capabilities?.color}
            onChange={detail.capabilities?.readOnly ? handleSimulate : handleWrite}
          />
        ) : detail.valueType === 'Bool' ? (
          <CFormCheck
            checked={currentValue === true}
            disabled={busy}
            onChange={(e) => handleWrite(e.target.checked)}
          />
        ) : (
          <NumericStepper
            value={currentValue}
            step={0.5}
            busy={busy}
            onCommit={(value) =>
              detail.capabilities?.readOnly ? handleSimulate(value) : handleWrite(value)
            }
          />
        )}
      </CTableDataCell>
      <CTableDataCell>
        {!detail.capabilities?.readOnly && (
          // Always rendered (just disabled outside MANUAL) - conditionally
          // rendering only while MANUAL made the whole column resize the
          // moment any one row switched mode, since the column width
          // follows its widest cell across every row.
          <CButton
            size="sm"
            color={mode === 'MANUAL' ? 'warning' : 'secondary'}
            variant={mode === 'MANUAL' ? undefined : 'outline'}
            disabled={busy || mode !== 'MANUAL'}
            onClick={handleAuto}
          >
            {busy ? <CSpinner size="sm" /> : 'Auto'}
          </CButton>
        )}
      </CTableDataCell>
    </CTableRow>
  )
}

const DevSimulator = () => {
  const [devices, setDevices] = useState(null)
  const [systemMode, setSystemMode] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .listDevices()
      .then((all) => setDevices(all.filter((d) => d.backend === 'virtual')))
      .catch((err) => setError(err.message))
    api
      .getSystemMode()
      .then((res) => setSystemMode(res.mode))
      .catch(() => setSystemMode(null))
  }, [])

  if (error && !devices) return <CAlert color="danger">{error}</CAlert>
  if (!devices) return <CSpinner color="primary" />

  return (
    <CCard className="mb-4">
      {error && (
        <CToaster placement="top-end">
          <CToast
            autohide={false}
            visible
            color="danger"
            className="text-white align-items-center"
            onClose={() => setError(null)}
          >
            <div className="d-flex">
              <CToastBody>{error}</CToastBody>
              <CToastClose className="me-2 m-auto" white />
            </div>
          </CToast>
        </CToaster>
      )}
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <strong>Dev Simulator</strong>
        <div>
          {systemMode && (
            <>
              System mode: <CBadge color={modeColor(systemMode)}>{systemMode}</CBadge>{' '}
            </>
          )}
          <LiveBadge />
        </div>
      </CCardHeader>
      <CCardBody>
        {devices.length === 0 ? (
          <CAlert color="info">No virtual devices registered yet.</CAlert>
        ) : (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                <CTableHeaderCell scope="col">Current value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Auto value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Mode</CTableHeaderCell>
                <CTableHeaderCell scope="col">Override</CTableHeaderCell>
                <CTableHeaderCell scope="col" />
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {devices.map((device) => (
                <DeviceSimulatorRow key={device.id} device={device} onError={setError} />
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default DevSimulator
