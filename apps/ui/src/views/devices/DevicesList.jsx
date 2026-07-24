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
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'

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

const matchesSearch = (device, search) => {
  if (!search) return true
  const needle = search.toLowerCase()
  return [device.name, device.type].some((field) => field?.toLowerCase().includes(needle))
}

const DevicesList = () => {
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api
      .listDevices()
      .then(setDevices)
      .catch((err) => setError(err.message))
  }, [])

  const filtered = (devices ?? []).filter((device) => matchesSearch(device, search))
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered)

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Devices</strong>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {!error && !devices && <CSpinner color="primary" />}
        {!error && devices && (
          <>
            <div className="mb-3">
              <TableSearchInput
                value={search}
                onSearch={setSearch}
                placeholder="Search by name, type..."
              />
            </div>
            {filtered.length === 0 ? (
              <CAlert color="info">
                {devices.length === 0
                  ? 'No devices registered yet.'
                  : 'No devices match this search.'}
              </CAlert>
            ) : (
              <>
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
                    {pageItems.map((device) => (
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
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={totalItems}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </>
            )}
          </>
        )}
      </CCardBody>
    </CCard>
  )
}

export default DevicesList
