import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormSelect,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { cilSettings } from '@coreui/icons'
import { api } from '../../api/client'
import GroupsConfigModal from '../../components/GroupsConfigModal'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'
import DeviceSettingsModal from './DeviceSettingsModal'

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

/**
 * Devices list (AGENTS_TO_DO.md, 2026-08-01) - now with Device Group and
 * Node filters, a page-level Config button (left of Clear Filters) that
 * manages the Device Group list itself, and a per-row Settings popup that
 * edits *this* device's group memberships (multiple - shared devices) and
 * Node assignment (single, nullable) together. Also fixes a pre-existing
 * bug: the Node column showed the raw `node_id` FK instead of the
 * resolved node name.
 */
const DevicesList = () => {
  const [devices, setDevices] = useState(null)
  const [deviceGroups, setDeviceGroups] = useState([])
  const [nodes, setNodes] = useState([])
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [configVisible, setConfigVisible] = useState(false)
  const [settingsDevice, setSettingsDevice] = useState(null)

  const reloadDevices = () =>
    api
      .listDevices()
      .then(setDevices)
      .catch((err) => setError(err.message))
  const reloadDeviceGroups = () =>
    api
      .listDeviceGroups()
      .then(setDeviceGroups)
      .catch((err) => setError(err.message))

  useEffect(() => {
    reloadDevices()
    reloadDeviceGroups()
    api
      .listNodes()
      .then(setNodes)
      .catch((err) => setError(err.message))
  }, [])

  const filtered = (devices ?? [])
    .filter((device) => matchesSearch(device, search))
    .filter(
      (device) => !groupFilter || (device.device_group_ids ?? []).includes(Number(groupFilter)),
    )
    .filter((device) => !nodeFilter || String(device.node_id) === nodeFilter)
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered)

  const hasActiveFilters = Boolean(search) || Boolean(groupFilter) || Boolean(nodeFilter)
  const handleResetFilters = () => {
    setSearch('')
    setGroupFilter('')
    setNodeFilter('')
    setSearchResetToken((token) => token + 1)
  }

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
            <CRow className="mb-3 g-2 align-items-center">
              <CCol xs="auto">
                <CFormSelect
                  size="sm"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                >
                  <option value="">All groups</option>
                  {deviceGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </CFormSelect>
              </CCol>
              <CCol xs="auto">
                <CFormSelect
                  size="sm"
                  value={nodeFilter}
                  onChange={(e) => setNodeFilter(e.target.value)}
                >
                  <option value="">All nodes</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </CFormSelect>
              </CCol>
              <CCol xs="auto">
                <TableSearchInput
                  key={searchResetToken}
                  value={search}
                  onSearch={setSearch}
                  placeholder="Search by name, type..."
                />
              </CCol>
              <CCol className="d-flex justify-content-end gap-2">
                <IconButton
                  icon={cilSettings}
                  size="sm"
                  center
                  onClick={() => setConfigVisible(true)}
                  ariaLabel="Configure Device Groups"
                />
                <ResetFiltersButton active={hasActiveFilters} onClick={handleResetFilters} />
              </CCol>
            </CRow>
            {filtered.length === 0 ? (
              <CAlert color="info">
                {devices.length === 0
                  ? 'No devices registered yet.'
                  : 'No devices match these filters.'}
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
                      <CTableHeaderCell scope="col" className="text-end">
                        Actions
                      </CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {pageItems.map((device) => (
                      <CTableRow key={device.id}>
                        <CTableDataCell>
                          <Link to={`/devices/${device.id}`}>{device.name}</Link>
                        </CTableDataCell>
                        <CTableDataCell>{device.type}</CTableDataCell>
                        <CTableDataCell>{device.node_name ?? '-'}</CTableDataCell>
                        <CTableDataCell>
                          <CBadge color={backendColor(device.backend)}>{device.backend}</CBadge>
                        </CTableDataCell>
                        <CTableDataCell>
                          <StatusBadge device={device} />
                        </CTableDataCell>
                        <CTableDataCell className="text-end">
                          <IconButton
                            icon={cilSettings}
                            size="sm"
                            center
                            onClick={() => setSettingsDevice(device)}
                            ariaLabel={`${device.name} settings`}
                          />
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
      <GroupsConfigModal
        visible={configVisible}
        onClose={() => setConfigVisible(false)}
        title="Device Groups"
        addLabel="Add Group"
        namePlaceholder="Group name"
        items={deviceGroups}
        onAdd={async (name) => {
          await api.createDeviceGroup(name)
          reloadDeviceGroups()
        }}
        onRename={async (id, name) => {
          await api.renameDeviceGroup(id, name)
          reloadDeviceGroups()
          reloadDevices()
        }}
        onDelete={async (id) => {
          await api.deleteDeviceGroup(id)
          reloadDeviceGroups()
          reloadDevices()
        }}
      />
      <DeviceSettingsModal
        visible={Boolean(settingsDevice)}
        onClose={() => setSettingsDevice(null)}
        device={settingsDevice}
        deviceGroups={deviceGroups}
        nodes={nodes}
        onSaved={reloadDevices}
      />
    </CCard>
  )
}

export default DevicesList
