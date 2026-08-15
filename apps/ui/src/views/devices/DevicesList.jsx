import React, { useEffect, useState } from 'react'
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
import CIcon from '@coreui/icons-react'
import { cilCheck, cilLibrary, cilSettings, cilX } from '@coreui/icons'
import { api } from '../../api/client'
import GroupsConfigModal from '../../components/GroupsConfigModal'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import Switch from '../../components/Switch'
import ExpandAllToggleButton from '../../components/table/ExpandAllToggleButton'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import { useNow } from '../../hooks/useNow'
import { usePagination } from '../../hooks/usePagination'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useDeviceLiveState } from '../../api/useLiveDevice'
import RowStatusBadge from '../../components/table/RowStatusBadge'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { formatRelativeTime } from '../../utils/format'
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

// AGENTS_TO_DO.md, 2026-08-15 - see the poll's own useEffect comment
// below for why this is a plain interval rather than a live event.
const DEVICES_POLL_MS = 10000

const backendColor = (backend) => (backend === 'physical' ? 'primary' : 'info')

// Devices list redesign (AGENTS_TO_DO.md, 2026-08-14): icon column, with
// an optional colored-circle background when this device's own boolean
// value is true (device.capabilities.color, editable via
// DeviceSettingsModal).
const iconUrl = (iconPath) => (iconPath ? `/api${iconPath}` : null)

const DeviceIcon = ({ iconPath, activeColor, active }) => {
  const url = iconUrl(iconPath)
  const showBackground = active && Boolean(activeColor)
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: showBackground ? activeColor : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {url ? (
        <img src={url} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
      ) : (
        <CIcon icon={cilLibrary} className="text-body-secondary" />
      )}
    </div>
  )
}

// Value column - number as-is, a green/red circle+check/x for Bool (same
// idiom as the icon's own active-color circle, just fixed colors since
// this one isn't user-configurable), "JSON" for anything compound (a
// Device is meant to be atomic - AGENTS.md section 30 - this is a
// display-safety fallback, not an expected case), "-" when no value is
// known yet.
const ValueCell = ({ value }) => {
  if (value === undefined || value === null) return <span className="text-body-secondary">-</span>
  if (typeof value === 'boolean') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          borderRadius: '50%',
          backgroundColor: value ? '#2eb85c' : '#e55353',
        }}
      >
        <CIcon icon={value ? cilCheck : cilX} style={{ color: '#fff', width: 12, height: 12 }} />
      </span>
    )
  }
  if (typeof value === 'number') return <span>{value}</span>
  if (typeof value === 'object') return <CBadge color="secondary">JSON</CBadge>
  return <span>{String(value)}</span>
}

// A field whose own value is compound (capabilities, data_logger_control,
// heartbeat_control, dualState...) renders as inline JSON rather than
// being recursively flattened into more rows - simplest option that
// stays readable, per the user's own "якщо глибше - можливо json"
// suggestion (AGENTS_TO_DO.md, 2026-08-15).
const formatFieldValue = (value) => {
  if (value === undefined || value === null || value === '') {
    return <span className="text-body-secondary">-</span>
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') {
    return (
      <code className="small text-body-secondary" style={{ wordBreak: 'break-all' }}>
        {JSON.stringify(value)}
      </code>
    )
  }
  return String(value)
}

// Accepts either an epoch-ms number (readingOrigin) or an ISO string
// (created_at/updated_at) - both are already Date-constructible as-is.
const formatDate = (value) => (value ? new Date(value).toLocaleString() : undefined)

// Borderless label/value table, one per side of the expand row (below).
// `flex: '0 1 420px'` (not just a plain block) - a plain <div> wrapping
// a Bootstrap table (which defaults to width: 100%) otherwise stretches
// to fill the whole flex container on its own, pushing the second table
// onto its own line regardless of `flex-wrap` (found live, 2026-08-15 -
// two tables stacked vertically instead of side by side).
const KeyValueTable = ({ title, rows }) => (
  <div style={{ flex: '0 1 420px', minWidth: 280 }}>
    <CTable small borderless className="mb-0 w-auto">
      <CTableBody>
        {rows
          .filter((row) => row.value !== undefined)
          .map((row) => (
            <CTableRow key={row.label}>
              <CTableDataCell
                className="text-body-secondary bg-transparent py-1"
                style={{ width: 150 }}
              >
                {row.label}
              </CTableDataCell>
              <CTableDataCell className="bg-transparent py-1">
                {formatFieldValue(row.value)}
              </CTableDataCell>
            </CTableRow>
          ))}
      </CTableBody>
    </CTable>
  </div>
)

// Detail row (AGENTS_TO_DO.md, 2026-08-02, redesigned 2026-08-15) - two
// borderless tables: live/reading data on the left (from `fetched`, the
// same GET /devices/:id DeviceRow already fetches once), permanent/
// registry data on the right (from `device`, the list row - id/type/
// node/backend/EdgeX identity/capabilities/...). Replaces the old
// LED/buzzer-specific big indicator entirely - the collapsed row's own
// icon+value cell already covers that at-a-glance role now (section 53).
const DeviceDetailRow = ({ device, fetched, expiresAt }) => {
  const dualState = fetched?.dualState
  return (
    <div className="p-3 pt-0 d-flex flex-wrap gap-4">
      <KeyValueTable
        title="Value"
        rows={[
          { label: 'Value', value: fetched?.value },
          { label: 'Value type', value: fetched?.valueType },
          { label: 'Units', value: fetched?.units },
          { label: 'Mode', value: dualState?.mode },
          { label: 'Auto value', value: dualState?.valueAuto },
          { label: 'Manual value', value: dualState?.valueManual },
          // formatRelativeTime (utils/format.js, already used by
          // NodesList.jsx's own last-heartbeat column) is typed for an
          // ISO string but really just does `new Date(x)` - an epoch-ms
          // number (readingOrigin/expiresAt) works identically.
          {
            label: 'Last reading',
            value: fetched?.readingOrigin ? formatRelativeTime(fetched.readingOrigin) : undefined,
          },
          // Same overdue threshold DeviceRow's own row-color check uses
          // (data_logger_control's periodSeconds * error.
          // numberSkippedPeriods) - previously only visible indirectly as
          // the row turning danger-red, not as an actual value (AGENTS_TO_DO.md,
          // 2026-08-15: "не бачу значення expiration").
          { label: 'Expires', value: expiresAt ? formatRelativeTime(expiresAt) : undefined },
        ]}
      />
      <KeyValueTable
        title="Device"
        rows={[
          { label: 'ID', value: device.id },
          { label: 'Type', value: device.type },
          { label: 'Node', value: device.node_name },
          { label: 'Backend', value: device.backend },
          { label: 'EdgeX name', value: device.edgex_device_name },
          { label: 'EdgeX status', value: device.edgex?.operatingState },
          { label: 'Simulated', value: device.simulated },
          { label: 'Simulated twin', value: device.edgex_device_name_simulated },
          { label: 'Capabilities', value: device.capabilities },
          { label: 'Data Logger', value: device.data_logger_control },
          { label: 'Heartbeat Control', value: device.heartbeat_control },
          { label: 'Created', value: formatDate(device.created_at) },
          { label: 'Updated', value: formatDate(device.updated_at) },
        ]}
      />
    </div>
  )
}

// One device's own row - owns the single fetch-once-then-overlay-live
// value (moved up from DeviceDetailRow, 2026-08-14, since the collapsed
// row now shows the value too, not just the expanded one) and the
// overdue/staleness check.
const DeviceRow = ({
  device,
  expanded,
  onToggleExpand,
  onToggleSimulated,
  onOpenSettings,
  effectivelySimulated,
}) => {
  const [fetched, setFetched] = useState(null)
  const live = useDeviceLiveState(device.id)
  const now = useNow()

  useEffect(() => {
    api
      .getDevice(device.id)
      .then(setFetched)
      .catch(() => {})
  }, [device.id])

  const value = live.value !== undefined ? live.value : fetched?.value
  // Reading timestamp: prefer a live WebSocket event (freshest, if one
  // has arrived this session) over the one-time fetch's own
  // `readingOrigin` (EdgeX's own reading timestamp - correct even on a
  // page that just loaded and hasn't seen a live event yet). `live.
  // timestamp` is an ISO string (dualDevicesModel.ts's own
  // `new Date().toISOString()`), not the ms-epoch number `readingOrigin`
  // already is - normalized to ms here so the two are comparable.
  const lastReadingAt = live.timestamp
    ? new Date(live.timestamp).getTime()
    : (fetched?.readingOrigin ?? null)

  // Overdue/staleness (AGENTS_TO_DO.md, 2026-08-14: "danger, якщо
  // прострочений") - reuses the same data_logger_control config
  // (periodSeconds + error.numberSkippedPeriods) the Data Logger process
  // already tracks server-side (AGENTS.md section 21-adjacent), rather
  // than inventing a separate threshold. Only evaluated when that config
  // is actually set and a reading time is known - a device with no
  // logging cadence configured, or one this page hasn't managed to read
  // yet, is simply not flagged either way.
  const dlc = device.data_logger_control
  const maxAgeMs =
    dlc?.periodSeconds && dlc?.error?.numberSkippedPeriods
      ? dlc.periodSeconds * dlc.error.numberSkippedPeriods * 1000
      : null
  const isOverdue =
    maxAgeMs !== null && lastReadingAt !== null && now > 0 && now - lastReadingAt > maxAgeMs
  // Surfaced as an actual value in the expand row (AGENTS_TO_DO.md,
  // 2026-08-15) - previously this threshold only showed up indirectly,
  // as the row turning danger-red.
  const expiresAt = maxAgeMs !== null && lastReadingAt !== null ? lastReadingAt + maxAgeMs : null

  // Background-color rule (AGENTS_TO_DO.md, 2026-08-15, applied across
  // Devices/Nodes/Processes tables): error -> danger, simulation -> info
  // (not warning - a device has no separate "warning" tier of its own
  // today, only overdue/error and simulated). Overdue wins over
  // simulated - same "highest severity wins, never both at once"
  // precedence ProcessesTable.jsx's own row color already uses.
  // RowStatusBadge (column 1 below) derives its label from this exact
  // value, not a second parallel condition, so the two can't drift.
  const rowColor = isOverdue ? 'danger' : effectivelySimulated ? 'info' : undefined
  const noBorderWhenExpanded = expanded ? 'border-bottom-0' : undefined

  return (
    <React.Fragment>
      <CTableRow color={rowColor}>
        <CTableDataCell className={noBorderWhenExpanded}>
          <RowStatusBadge rowColor={rowColor} />
        </CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>
          <CBadge color={backendColor(device.backend)}>{device.backend}</CBadge>
        </CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>
          <DeviceIcon
            iconPath={device.icon_path}
            activeColor={device.capabilities?.color}
            active={value === true}
          />
        </CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>
          <ValueCell value={value} />
        </CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>{device.name}</CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>{device.type}</CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>{device.node_name ?? '-'}</CTableDataCell>
        <CTableDataCell className={`text-end ${noBorderWhenExpanded ?? ''}`}>
          <div className="d-flex justify-content-end align-items-center gap-1 flex-nowrap">
            <IconButton
              icon={cilSettings}
              size="sm"
              center
              onClick={onOpenSettings}
              ariaLabel={`${device.name} settings`}
            />
            {device.node_id === null && (
              <Switch
                checked={device.simulated}
                onChange={onToggleSimulated}
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
            <ExpandToggleButton expanded={expanded} onClick={onToggleExpand} />
          </div>
        </CTableDataCell>
      </CTableRow>
      {expanded && (
        <CTableRow color={rowColor}>
          <CTableDataCell colSpan={8} className="p-0">
            <DeviceDetailRow device={device} fetched={fetched} expiresAt={expiresAt} />
          </CTableDataCell>
        </CTableRow>
      )}
    </React.Fragment>
  )
}

const matchesSearch = (device, search) => {
  if (!search) return true
  const needle = search.toLowerCase()
  return [device.name, device.type].some((field) => field?.toLowerCase().includes(needle))
}

/**
 * Devices list (AGENTS_TO_DO.md, 2026-08-01, redesigned 2026-08-14) - Device
 * Group and Node filters, a page-level Config button (left of Clear
 * Filters) that manages the Device Group list itself, and a per-row
 * Settings popup that edits *this* device's group memberships (multiple -
 * shared devices), Node assignment (single, nullable), and capabilities
 * (Physical ID placeholder, active-background-color) together. Name is
 * plain text now, not a link - the old dedicated /devices/:id page was
 * removed (2026-08-14, "У нас є розгортка" - the expand row already
 * covers it).
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

  // AGENTS_TO_DO.md, 2026-08-15 - toggling a node's own simulated flag
  // from a DIFFERENT tab (e.g. NodesList.jsx there) doesn't push any
  // live event this page could subscribe to (no `node` domain exists in
  // the live WebSocket protocol at all today - see AGENTS.md's own
  // writeup on why polling was chosen over adding one). Periodic
  // refetch is the same "UI convenience poll, not a control loop"
  // precedent ProcessesList.jsx's own registered-kinds poll already
  // established, applied here to converge `node_simulated`/`simulated`
  // (and everything else GET /devices returns) within one interval of
  // a change made anywhere else.
  useEffect(() => {
    const interval = setInterval(reloadDevices, DEVICES_POLL_MS)
    return () => clearInterval(interval)
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
                <CTable responsive>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Backend</CTableHeaderCell>
                      <CTableHeaderCell scope="col" style={{ width: 40 }}></CTableHeaderCell>
                      <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Type</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Node</CTableHeaderCell>
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
                      // `effectivelySimulated` - a node-attached device has
                      // no switch of its own (see below) but is still
                      // visually "simulated" right now whenever its parent
                      // node is (`node_simulated`, from
                      // SELECT_DEVICE_LIST_BASE's own join) - the row
                      // highlight should reflect what's actually resolving,
                      // not just this row's own `simulated` column.
                      const effectivelySimulated =
                        device.node_id === null ? device.simulated : device.node_simulated
                      return (
                        <DeviceRow
                          key={device.id}
                          device={device}
                          expanded={isExpanded(device.id)}
                          onToggleExpand={() => toggleOne(device.id)}
                          onToggleSimulated={() => handleToggleSimulated(device)}
                          onOpenSettings={() => setSettingsDevice(device)}
                          effectivelySimulated={effectivelySimulated}
                        />
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
