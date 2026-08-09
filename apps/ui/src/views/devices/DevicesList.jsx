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
import Switch from '../../components/Switch'
import ExpandAllToggleButton from '../../components/table/ExpandAllToggleButton'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import { usePagination } from '../../hooks/usePagination'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import BuzzerIndicator from '../../components/indicators/BuzzerIndicator'
import StatusIndicator from '../../components/indicators/StatusIndicator'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import DeviceSettingsModal from './DeviceSettingsModal'

// Registration for usePersistedState (AGENTS_TO_DO.md, 2026-08-01, joined
// 2026-08-02 by `expandedIds`) - flat variant, same as NodesList.jsx.
const PERSISTED_DEFAULTS = {
  search: '',
  groupFilter: '',
  nodeFilter: '',
  pageSize: 10,
  expandedIds: [],
}

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

// Detail row (AGENTS_TO_DO.md, 2026-08-02) - live indicators for the two
// kinds Alarm Annunciator/Active Zummer already use (same 48px
// StatusIndicator/BuzzerIndicator as Processes -> Active Zummer's own
// panel), raw value for everything else for now ("Показуй поки що сире
// значення") - one REST fetch on expand (same "get once, then overlay
// live" shape ActiveBuzzerPanel.jsx already uses) plus the live overlay,
// so the value is correct immediately rather than waiting for this
// device's next WS event.
const DeviceDetailRow = ({ device }) => {
  const [fetched, setFetched] = useState(null)
  const live = useDeviceLiveState(device.id)

  useEffect(() => {
    api
      .getDevice(device.id)
      .then(setFetched)
      .catch(() => {})
  }, [device.id])

  const value = live.value !== undefined ? live.value : fetched?.value
  const active = value === true

  return (
    <div className="p-3 pt-0">
      {device.type === 'active-buzzer' ? (
        <BuzzerIndicator active={active} />
      ) : device.type === 'led' ? (
        // `color` (2026-08-09, "control-node" node type) - optional
        // per-instance hint (device.capabilities.color), StatusIndicator
        // falls back to its own default blue when absent, so every
        // pre-existing LED (e.g. Alarm Annunciator's 16) is unaffected.
        <StatusIndicator active={active} color={device.capabilities?.color} />
      ) : (
        <span className="text-body-secondary">{value !== undefined ? String(value) : '-'}</span>
      )}
    </div>
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
  const [pageState, setPageState] = usePersistedState('nexusedge.devicesPage', PERSISTED_DEFAULTS)
  const { search, groupFilter, nodeFilter, expandedIds } = pageState
  const setSearch = (value) => setPageState({ search: value })
  const setGroupFilter = (value) => setPageState({ groupFilter: value })
  const setNodeFilter = (value) => setPageState({ nodeFilter: value })
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)
  // Not persisted - a TableSearchInput remount trigger only, see
  // NodesList.jsx's identical comment.
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

  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - standalone
  // devices only (node-attached ones switch via their node instead, see
  // NodesList.jsx - the server rejects this call for those anyway).
  const handleToggleSimulated = (device) =>
    api
      .setDeviceSimulated(device.id, !device.simulated)
      .then(reloadDevices)
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
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: pageState.pageSize,
    onPageSizeChange: (size) => setPageState({ pageSize: size }),
  })

  const hasActiveFilters = Boolean(search) || Boolean(groupFilter) || Boolean(nodeFilter)
  const handleResetFilters = () => {
    setPageState({ search: '', groupFilter: '', nodeFilter: '' })
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
                        <div className="d-flex justify-content-end align-items-center gap-2">
                          <span>Actions</span>
                          <ExpandAllToggleButton
                            ids={pageItems.map((device) => device.id)}
                            expandedIds={expandedIds}
                            setExpandedIds={setExpandedIds}
                          />
                        </div>
                      </CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {pageItems.map((device) => {
                      // Same `border-bottom-0` idiom ProcessesTable.jsx's own
                      // expanded row already uses (AGENTS_TO_DO.md, 2026-08-10
                      // "візуальна консистентність"). `effectivelySimulated`
                      // - a node-attached device has no switch of its own
                      // (see below) but is still visually "simulated" right
                      // now whenever its parent node is (`node_simulated`,
                      // from SELECT_DEVICE_LIST_BASE's own join) - the row
                      // highlight should reflect what's actually resolving,
                      // not just this row's own `simulated` column.
                      const expandedRow = isExpanded(device.id)
                      const noBorderWhenExpanded = expandedRow ? 'border-bottom-0' : undefined
                      const effectivelySimulated = device.node_id === null ? device.simulated : device.node_simulated
                      return (
                      <React.Fragment key={device.id}>
                        <CTableRow color={effectivelySimulated ? 'warning' : undefined}>
                          <CTableDataCell className={noBorderWhenExpanded}>
                            <Link to={`/devices/${device.id}`}>{device.name}</Link>
                          </CTableDataCell>
                          <CTableDataCell className={noBorderWhenExpanded}>{device.type}</CTableDataCell>
                          <CTableDataCell className={noBorderWhenExpanded}>{device.node_name ?? '-'}</CTableDataCell>
                          <CTableDataCell className={noBorderWhenExpanded}>
                            <CBadge color={backendColor(device.backend)}>{device.backend}</CBadge>
                          </CTableDataCell>
                          <CTableDataCell className={noBorderWhenExpanded}>
                            <StatusBadge device={device} />
                          </CTableDataCell>
                          <CTableDataCell className={`text-end ${noBorderWhenExpanded ?? ''}`}>
                            <div className="d-flex justify-content-end align-items-center gap-1 flex-nowrap">
                              <IconButton
                                icon={cilSettings}
                                size="sm"
                                center
                                onClick={() => setSettingsDevice(device)}
                                ariaLabel={`${device.name} settings`}
                              />
                              {device.node_id === null && (
                                <Switch
                                  checked={device.simulated}
                                  onChange={() => handleToggleSimulated(device)}
                                  disabled={!device.simulated && !device.edgex_device_name_simulated}
                                  activeColor="#e55353"
                                  inactiveColor="#d3d3d3"
                                  ariaLabel={
                                    device.simulated
                                      ? `${device.name} is simulated - switch to physical`
                                      : device.edgex_device_name_simulated
                                        ? `${device.name} is physical - switch to simulated`
                                        : `${device.name} has no simulated twin provisioned`
                                  }
                                />
                              )}
                              <ExpandToggleButton
                                expanded={isExpanded(device.id)}
                                onClick={() => toggleOne(device.id)}
                              />
                            </div>
                          </CTableDataCell>
                        </CTableRow>
                        {expandedRow && (
                          <CTableRow color={effectivelySimulated ? 'warning' : undefined}>
                            <CTableDataCell colSpan={6} className="p-0">
                              <DeviceDetailRow device={device} />
                            </CTableDataCell>
                          </CTableRow>
                        )}
                      </React.Fragment>
                      )
                    })}
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
