import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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

const backendColor = (backend) => (backend === 'physical' ? 'primary' : 'info')

const StatusBadge = ({ device }) => {
  if (!device.edgex) {
    return <CBadge color="secondary">not provisioned</CBadge>
  }
  return (
    <CBadge color={device.edgex.operatingState === 'UP' ? 'success' : 'danger'}>
      {device.edgex.operatingState}
    </CBadge>
  )
}

const DevicesList = () => {
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .listDevices()
      .then(setDevices)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Devices</strong>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {!error && !devices && <CSpinner color="primary" />}
        {!error && devices && devices.length === 0 && (
          <CAlert color="info">No devices registered yet.</CAlert>
        )}
        {!error && devices && devices.length > 0 && (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                <CTableHeaderCell scope="col">Type</CTableHeaderCell>
                <CTableHeaderCell scope="col">Node</CTableHeaderCell>
                <CTableHeaderCell scope="col">Backend</CTableHeaderCell>
                <CTableHeaderCell scope="col">Status</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {devices.map((device) => (
                <CTableRow key={device.id}>
                  <CTableDataCell>
                    <Link to={`/devices/${device.id}`}>{device.name}</Link>
                  </CTableDataCell>
                  <CTableDataCell>{device.type}</CTableDataCell>
                  <CTableDataCell>{device.node_id ?? '-'}</CTableDataCell>
                  <CTableDataCell>
                    <CBadge color={backendColor(device.backend)}>{device.backend}</CBadge>
                  </CTableDataCell>
                  <CTableDataCell>
                    <StatusBadge device={device} />
                  </CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default DevicesList
