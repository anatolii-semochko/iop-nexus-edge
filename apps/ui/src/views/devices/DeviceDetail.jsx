import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { api } from '../../api/client'

const formatValue = (reading) => {
  if (!reading) return '-'
  return reading.units ? `${reading.value} ${reading.units}` : reading.value
}

/**
 * Production-style device view: read-only current state. Generic (not
 * device-specific) since no real device type exists yet under devices/ -
 * see AGENTS.md section 7 for the eventual per-device-type ui/control
 * component this is a stand-in for.
 */
const DeviceDetail = () => {
  const { id } = useParams()
  const [device, setDevice] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .getDevice(id)
      .then(setDevice)
      .catch((err) => setError(err.message))
  }, [id])

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!device) return <CSpinner color="primary" />

  const resourceNames = Object.keys(device.resources ?? {})

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>{device.name}</strong> <small>{device.type}</small>{' '}
        <CBadge color={device.backend === 'physical' ? 'primary' : 'info'}>{device.backend}</CBadge>
      </CCardHeader>
      <CCardBody>
        {resourceNames.length === 0 && <CAlert color="info">No resources reported.</CAlert>}
        {resourceNames.length > 0 && (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Resource</CTableHeaderCell>
                <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Type</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {resourceNames.map((name) => (
                <CTableRow key={name}>
                  <CTableDataCell>{name}</CTableDataCell>
                  <CTableDataCell>{formatValue(device.resources[name])}</CTableDataCell>
                  <CTableDataCell>{device.resources[name]?.valueType ?? '-'}</CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default DeviceDetail
