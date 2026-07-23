import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CFormCheck,
  CFormInput,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { api } from '../../api/client'

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
 * One virtual device: all its resources, current values, and inputs to
 * override them (writes through Devices API -> EdgeX core-command, handled
 * by the Virtual Node Runtime - see AGENTS.md section 6). This is the
 * generic stand-in for the per-device-type dev/ui simulator described in
 * AGENTS.md section 7.
 */
const DeviceSimulatorCard = ({ device }) => {
  const [detail, setDetail] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState(null)
  const [busyResource, setBusyResource] = useState(null)

  const load = () => {
    api
      .getDevice(device.id)
      .then((d) => {
        setDetail(d)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(load, [device.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (resource) => {
    setBusyResource(resource)
    setError(null)
    try {
      // Fall back to the currently displayed value (same logic the table
      // renders with) rather than the raw draft, which is still undefined
      // if the user never touched this resource's input - sending
      // `undefined` would drop `value` from the request body entirely.
      const reading = detail.resources[resource]
      const value = drafts[resource] ?? reading?.value ?? ''
      await api.writeResource(device.id, resource, value)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyResource(null)
    }
  }

  const handleRelease = async (resource) => {
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

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!detail) return <CSpinner color="primary" />

  const resourceNames = Object.keys(detail.resources ?? {})

  return (
    <CCard className="mb-4">
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
                <CTableHeaderCell scope="col">Mode</CTableHeaderCell>
                <CTableHeaderCell scope="col">Override</CTableHeaderCell>
                <CTableHeaderCell scope="col" />
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {resourceNames.map((name) => {
                const reading = detail.resources[name]
                const valueType = reading?.valueType
                const draft = drafts[name] ?? reading?.value ?? ''
                const mode = detail.dualState?.[name]?.mode ?? 'AUTO'
                const busy = busyResource === name

                return (
                  <CTableRow key={name}>
                    <CTableDataCell>{name}</CTableDataCell>
                    <CTableDataCell>{reading ? String(reading.value) : '-'}</CTableDataCell>
                    <CTableDataCell>
                      <CBadge color={modeColor(mode)}>{mode}</CBadge>
                    </CTableDataCell>
                    <CTableDataCell>
                      {valueType === 'Bool' ? (
                        <CFormCheck
                          checked={draft === true || draft === 'true'}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [name]: e.target.checked }))
                          }
                        />
                      ) : (
                        <CFormInput
                          type="text"
                          size="sm"
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [name]: e.target.value }))
                          }
                        />
                      )}
                    </CTableDataCell>
                    <CTableDataCell>
                      <CButton size="sm" color="primary" disabled={busy} onClick={() => handleSave(name)}>
                        {busy ? <CSpinner size="sm" /> : 'Set'}
                      </CButton>{' '}
                      <CButton
                        size="sm"
                        color="secondary"
                        variant="outline"
                        disabled={busy || mode !== 'MANUAL'}
                        onClick={() => handleRelease(name)}
                      >
                        Release to Auto
                      </CButton>
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
      {systemMode && (
        <CAlert color="secondary">
          System mode: <CBadge color={modeColor(systemMode)}>{systemMode}</CBadge>
        </CAlert>
      )}
      {devices.length === 0 && <CAlert color="info">No virtual devices registered yet.</CAlert>}
      {devices.map((device) => (
        <DeviceSimulatorCard key={device.id} device={device} />
      ))}
    </>
  )
}

export default DevSimulator
