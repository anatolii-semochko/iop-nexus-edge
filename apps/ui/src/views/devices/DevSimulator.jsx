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
import LightRegulatorSimulator from 'devices/standalone/light-regulator/ui/simulator/LightRegulatorSimulator.jsx'

// device.type -> {resourceName: SimulatorComponent} - a device type's own
// ui/simulator component (AGENTS.md section 7), for the one resource it
// applies to. Only one real device type exists today; this is a plain map
// rather than a discovery mechanism because there is nothing yet to
// discover more than one of.
const DEVICE_TYPE_SIMULATORS = {
  'light-regulator': { Level: LightRegulatorSimulator },
}

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
 * One virtual device: all its resources, current/auto values, and controls
 * to override them - writes through Devices API -> EdgeX core-command,
 * handled by the Virtual Node Runtime (AGENTS.md section 6). Generic
 * stand-in for the per-device-type dev/ui simulator (AGENTS.md section 7),
 * except for resources a device type has its own component for (see
 * DEVICE_TYPE_SIMULATORS).
 */
const DeviceSimulatorCard = ({ device }) => {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [busyResource, setBusyResource] = useState(null)
  const live = useDeviceLiveState(device.id)
  const debounceTimers = useRef({})

  const load = () => {
    api
      .getDevice(device.id)
      .then((d) => {
        setDetail(d)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(load, [device.id])

  useEffect(() => () => Object.values(debounceTimers.current).forEach(clearTimeout), [])

  // Actuator resources (Bool checkboxes, numeric commits): a UI write is
  // always a manual override (Dual Devices Model MANUAL - AGENTS.md
  // section 6), applied instantly, no separate "Set" step.
  const handleWrite = async (resource, value) => {
    setBusyResource(resource)
    setError(null)
    try {
      await api.writeResource(device.id, resource, value)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyResource(null)
    }
  }

  // Read-only sensor resources: no Dual Devices Model, no "Set" step either
  // - the slider (or other simulator control) itself is the input, debounced
  // so dragging doesn't flood the API/bus with every intermediate position.
  const handleSimulate = (resource, value) => {
    setError(null)
    clearTimeout(debounceTimers.current[resource])
    debounceTimers.current[resource] = setTimeout(async () => {
      try {
        await api.simulateResource(device.id, resource, value)
        load()
      } catch (err) {
        setError(err.message)
      }
    }, SLIDER_DEBOUNCE_MS)
  }

  const handleAuto = async (resource) => {
    setBusyResource(resource)
    setError(null)
    try {
      await api.releaseResource(device.id, resource)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyResource(null)
    }
  }

  // A failure loading the device in the first place leaves nothing else to
  // show. A failure from an action afterwards (write/simulate/release) is
  // different - the table is already up and still valid, so it surfaces as
  // a dismissable toast instead (see below) rather than replacing the
  // whole card, which used to hide the entire table behind a single failed
  // write (e.g. a 409 "forbidden state" from the Model State Validator).
  if (error && !detail) return <CAlert color="danger">{error}</CAlert>
  if (!detail) return <CSpinner color="primary" />

  const resourceNames = Object.keys(detail.resources ?? {}).sort()

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
      <CCardHeader>
        <strong>{detail.name}</strong> <small>{detail.type}</small>
      </CCardHeader>
      <CCardBody>
        {resourceNames.length === 0 && <CAlert color="info">No resources reported.</CAlert>}
        {resourceNames.length > 0 && (
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Resource</CTableHeaderCell>
                <CTableHeaderCell scope="col">Current value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Auto value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Mode</CTableHeaderCell>
                <CTableHeaderCell scope="col">Override</CTableHeaderCell>
                <CTableHeaderCell scope="col" />
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {resourceNames.map((name) => {
                const reading = detail.resources[name]
                const liveEntry = live[name]
                const currentValue = liveEntry ? liveEntry.value : reading?.value
                const valueType = reading?.valueType
                const resourceCap = detail.capabilities?.resources?.find(
                  (r) => r.name === name,
                ) ?? { name }
                // No fallback to "AUTO" - a readOnly (sensor) resource has
                // no Dual Devices Model mode at all (AGENTS.md section 6/7).
                const mode = liveEntry?.mode ?? detail.dualState?.[name]?.mode
                const autoValue = resourceCap.readOnly
                  ? undefined
                  : (liveEntry?.valueAuto ?? detail.dualState?.[name]?.valueAuto)
                const mismatch =
                  autoValue !== undefined && String(autoValue) !== String(currentValue)
                const busy = busyResource === name
                const CustomSimulator = DEVICE_TYPE_SIMULATORS[detail.type]?.[name]

                return (
                  <CTableRow key={name}>
                    <CTableDataCell>{name}</CTableDataCell>
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
                        <CustomSimulator
                          value={currentValue}
                          min={resourceCap.min}
                          max={resourceCap.max}
                          step={resourceCap.step}
                          onChange={(value) => handleSimulate(name, value)}
                        />
                      ) : valueType === 'Bool' ? (
                        <CFormCheck
                          checked={currentValue === true}
                          disabled={busy}
                          onChange={(e) => handleWrite(name, e.target.checked)}
                        />
                      ) : (
                        <NumericStepper
                          value={currentValue}
                          step={0.5}
                          busy={busy}
                          onCommit={(value) =>
                            resourceCap.readOnly
                              ? handleSimulate(name, value)
                              : handleWrite(name, value)
                          }
                        />
                      )}
                    </CTableDataCell>
                    <CTableDataCell>
                      {!resourceCap.readOnly && (
                        // Always rendered (just disabled outside MANUAL) -
                        // conditionally rendering only while MANUAL made the
                        // whole column resize the moment any one resource
                        // switched mode, since the column width follows its
                        // widest cell across every row.
                        <CButton
                          size="sm"
                          color={mode === 'MANUAL' ? 'warning' : 'secondary'}
                          variant={mode === 'MANUAL' ? undefined : 'outline'}
                          disabled={busy || mode !== 'MANUAL'}
                          onClick={() => handleAuto(name)}
                        >
                          {busy ? <CSpinner size="sm" /> : 'Auto'}
                        </CButton>
                      )}
                    </CTableDataCell>
                  </CTableRow>
                )
              })}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
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

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!devices) return <CSpinner color="primary" />

  return (
    <>
      <CAlert color="secondary">
        {systemMode && (
          <>
            System mode: <CBadge color={modeColor(systemMode)}>{systemMode}</CBadge>{' '}
          </>
        )}
        <LiveBadge />
      </CAlert>
      {devices.length === 0 && <CAlert color="info">No virtual devices registered yet.</CAlert>}
      {devices.map((device) => (
        <DeviceSimulatorCard key={device.id} device={device} />
      ))}
    </>
  )
}

export default DevSimulator
