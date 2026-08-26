import React, { useEffect, useRef, useState } from 'react'
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
import {
  useDeviceLiveState,
  useDevicesMetadataLiveState,
  useLiveConnectionStatus,
} from '../../api/useLiveDevice'
import { useNodesLiveState } from '../../api/useLiveNode'
import RowStatusBadge from '../../components/table/RowStatusBadge'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { formatRelativeTime } from '../../utils/format'
import DeviceSettingsModal from './DeviceSettingsModal'
import NumericStepper from './NumericStepper'

// Registration for usePersistedState (AGENTS_TO_DO.md, 2026-08-01, joined
// 2026-08-02 by `expandedIds`) - flat variant, same as NodesList.jsx.
const PERSISTED_DEFAULTS = {
  search: '',
  groupFilter: '',
  nodeFilter: '',
  statusFilter: '',
  pageSize: 10,
  expandedIds: [],
}

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
  if (typeof value === 'object')
    return (
      <CBadge color="secondary" className="mb-1">
        JSON
      </CBadge>
    )
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
// Was a flexbox item with a fixed `flex: '0 1 420px'` basis (2026-08-15,
// to stop a plain 100%-wide Bootstrap table forcing its sibling onto its
// own line) - that fix over-corrected: the fixed basis reserved 420px
// regardless of how narrow the table's own content actually was, and
// capped it at 420px even when the page had far more room to spare, so
// wide values (Capabilities/Data Logger JSON) wrapped awkwardly into a
// narrow column while a large blank margin sat unused to the right
// (found live, 2026-08-16 - "права таблиця має великий відступ
// справа"). Replaced with a CSS Grid parent (below) instead: each table
// now fills its own grid column exactly (`w-auto` removed, default
// Bootstrap `width: 100%` applies within that column), and grid's own
// `auto-fit`/`minmax` sizing is what decides column count/width, not a
// per-table flex-basis guess.
const KeyValueTable = ({ title, rows }) => (
  <div>
    <div
      className="text-body-secondary text-uppercase fw-semibold text-decoration-underline mb-1"
      style={{ fontSize: '0.6875rem', letterSpacing: '0.04em' }}
    >
      {title}
    </div>
    <CTable small borderless className="mb-0 small">
      <CTableBody>
        {rows
          .filter((row) => row.value !== undefined)
          .map((row) => (
            <CTableRow key={row.label}>
              <CTableDataCell
                className="text-body-secondary bg-transparent"
                style={{ width: 150, padding: '0.125rem 0.5rem 0.125rem 0' }}
              >
                {row.label}
              </CTableDataCell>
              <CTableDataCell className="bg-transparent" style={{ padding: '0.125rem 0.5rem' }}>
                {formatFieldValue(row.value)}
              </CTableDataCell>
            </CTableRow>
          ))}
      </CTableBody>
    </CTable>
  </div>
)

// Detail row (AGENTS_TO_DO.md, 2026-08-02, redesigned 2026-08-15,
// re-laid-out 2026-08-16) - two borderless tables: live/reading data on
// the left (from `fetched`, the same GET /devices/:id DeviceRow already
// fetches once), permanent/registry data on the right (from `device`,
// the list row - id/type/node/backend/EdgeX identity/capabilities/...).
// Replaces the old LED/buzzer-specific big indicator entirely - the
// collapsed row's own icon+value cell already covers that at-a-glance
// role now (section 53). CSS Grid, not flexbox (see KeyValueTable's own
// comment) - `auto-fit`/`minmax(320px, 1fr)` puts both tables on one row
// when there's room for two >=320px columns, wraps to one column
// per row otherwise, and each column claims its own fair share of
// whatever width is actually available instead of a fixed guess.
// Under the left "Value" table (AGENTS_TO_DO.md, 2026-08-23) - lets a
// readOnly device's current value be edited directly from this row when
// it's effectively simulated (own `simulated` flag, or its node's),
// instead of needing the separate Dev Simulator page for the same
// `PUT /devices/:id/simulate` write DevSimulator.jsx already uses.
// Numeric only, per the user's own spec ("Якщо це число") - Bool/String/
// JSON values have no editor here yet, not asked for. `editable` (new
// NumericStepper prop) is what makes the input itself typable here,
// unlike every other NumericStepper caller's disabled display-only
// input. `step` is this device's own "personal" step
// (`capabilities.step`, already an existing per-device field - see
// devices/standalone/*/edgex-device-profile.yaml's own `properties`) so
// e.g. a 0-4095 raw light reading steps by a meaningful chunk instead of
// DevSimulator's own generic step={0.5} fallback; falls back to 1 when a
// device type hasn't set one.
const SimulatedValueEditor = ({ device, value, onSimulate }) => (
  <div className="mt-2">
    <div
      className="text-body-secondary text-uppercase fw-semibold mb-1"
      style={{ fontSize: '0.6875rem', letterSpacing: '0.04em' }}
    >
      Simulated value
    </div>
    <NumericStepper
      value={value}
      step={device.capabilities?.step ?? 1}
      min={device.capabilities?.min}
      max={device.capabilities?.max}
      editable
      onCommit={onSimulate}
    />
  </div>
)

const DeviceDetailRow = ({
  device,
  fetched,
  value,
  expiresAt,
  effectivelySimulated,
  onSimulate,
}) => {
  const dualState = fetched?.dualState
  const canEditSimulatedValue =
    effectivelySimulated && device.capabilities?.readOnly && typeof value === 'number'
  return (
    <div
      className="pt-0 pb-3 px-2"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '0.5rem 2rem',
      }}
    >
      <div>
        <KeyValueTable
          title="Value"
          rows={[
            { label: 'Value', value },
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
        {canEditSimulatedValue && (
          <SimulatedValueEditor device={device} value={value} onSimulate={onSimulate} />
        )}
      </div>
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
  onSimulateValue,
  effectivelySimulated,
}) => {
  const [fetched, setFetched] = useState(null)
  const live = useDeviceLiveState(device.id)
  // Still needed even though isOverdue/expiresAt are no longer computed
  // here (AGENTS.md section 62) - the "Last reading"/"Expires" cells
  // (formatRelativeTime) read Date.now() internally at render time, so
  // this hook's own re-render-every-second is what makes "5 seconds ago"
  // keep ticking over on screen without any of *this* row's own data
  // actually changing.
  useNow()

  // AGENTS.md section 62 - one mount-time fetch for this row's own value/
  // isOverdue, same as NodesList.jsx's per-row state (section 61): both
  // GET /devices/:id (any on-demand UI read, including this one) and
  // POST /devices/:id/log (Data Logger's own periodic write-cadence read)
  // now publish a live `device` event whenever the *computed* overdue
  // status actually changes, so a passive transition converges without
  // this row ever polling again itself - useDeviceLiveState above already
  // subscribes to that. Previously mount-only was a real bug (section 60:
  // a row that went Error, computed from a stale client-side snapshot,
  // could never come back to OK) specifically *because* nothing else kept
  // it current; that's no longer true now that isOverdue is itself a
  // server-computed, live-pushed field.
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
  // прострочений"; moved server-side 2026-08-16, AGENTS.md section 62,
  // dataLoggerControl.ts's computeOverdue - same math as before, just no
  // longer duplicated client-side) - `live` wins when a push has arrived
  // this session (only present on an actual status change, see
  // useLiveDevice.js), otherwise whatever the last fetch computed.
  const isOverdue = live.isOverdue ?? fetched?.isOverdue ?? false
  const expiresAt = live.expiresAt ?? fetched?.expiresAt ?? null

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
          <CBadge color={backendColor(device.backend)} className="mb-1">
            {device.backend}
          </CBadge>
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
        <CTableDataCell className={noBorderWhenExpanded}>{device.node_name ?? '-'}</CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>{device.type}</CTableDataCell>
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
            <DeviceDetailRow
              device={device}
              fetched={fetched}
              value={value}
              expiresAt={expiresAt}
              effectivelySimulated={effectivelySimulated}
              onSimulate={onSimulateValue}
            />
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

// A node-attached device has no `simulated` switch of its own - it's
// visually "simulated" right now whenever its parent node is
// (`node_simulated`, from SELECT_DEVICE_LIST_BASE's own join). Factored
// out (AGENTS_TO_DO.md, 2026-08-16) so the new status filter and the row
// loop's own `effectivelySimulated` prop use the exact same rule.
const deviceEffectivelySimulated = (device) =>
  device.node_id === null ? device.simulated : device.node_simulated

// Background-color rule (section 56): error -> danger, simulation -> info.
// `device.isOverdue` here is the list route's own last-known snapshot
// (AGENTS_TO_DO.md, 2026-08-16 - GET /devices now includes it), which is
// what the status filter runs against; each DeviceRow's own rendered
// color instead uses its live-updated isOverdue (mount fetch + live
// push) - marginally fresher, but the two agree within one read/push
// interval of each other.
const deviceRowColor = (device) =>
  device.isOverdue ? 'danger' : deviceEffectivelySimulated(device) ? 'info' : undefined

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ok', label: 'OK' },
  { value: 'danger', label: 'Error' },
  { value: 'info', label: 'Simulation' },
]

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
  const { search, groupFilter, nodeFilter, statusFilter, expandedIds } = pageState
  const setSearch = (value) => setPageState({ search: value })
  const setGroupFilter = (value) => setPageState({ groupFilter: value })
  const setNodeFilter = (value) => setPageState({ nodeFilter: value })
  const setStatusFilter = (value) => setPageState({ statusFilter: value })
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)
  // Not persisted - a TableSearchInput remount trigger only, see
  // NodesList.jsx's identical comment.
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [configVisible, setConfigVisible] = useState(false)
  const [settingsDevice, setSettingsDevice] = useState(null)
  const deviceMetadata = useDevicesMetadataLiveState()
  const liveNodes = useNodesLiveState()
  const connected = useLiveConnectionStatus()

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

  // Simulated-value editor (AGENTS_TO_DO.md, 2026-08-23, DeviceDetailRow's
  // own SimulatedValueEditor) - same PUT /devices/:id/simulate write
  // DevSimulator.jsx's own handleSimulate uses. No reloadDevices() after -
  // unlike handleToggleSimulated above (a registry/metadata change with no
  // live push of its own until section 65 built one), a value write
  // already lands via the live `device` event useDeviceLiveState
  // subscribes to, so every open tab (including this row's own) converges
  // without a refetch.
  const handleSimulateValue = (device, value) =>
    api.simulateDevice(device.id, value).catch((err) => setError(err.message))

  useEffect(() => {
    reloadDevices()
    reloadDeviceGroups()
    api
      .listNodes()
      .then(setNodes)
      .catch((err) => setError(err.message))
  }, [])

  // AGENTS_TO_DO.md, 2026-08-23 - replaces the old DEVICES_POLL_MS list
  // poll (section 15/63's own deferred item - "toggling a node's own
  // simulated flag from a different tab doesn't push any live event this
  // page subscribes to... not migrated to [`node`] in this pass"). Two
  // live sources now cover what that poll used to converge every 10s:
  // `deviceMetadata` (routes/devices.ts's publishDeviceMetadata, on
  // rename/group/node reassignment/simulated/capabilities) patches a
  // device's own row directly; `liveNodes` (the same `node` domain
  // NodesList.jsx already uses) patches `node_name`/`node_simulated` for
  // every device attached to a node that changed - no full refetch
  // either way. Only a dropped-then-restored WebSocket connection still
  // needs a one-shot catch-up fetch (can't have delivered anything while
  // down) - `connected`'s own `false -> true` transition, skipping the
  // initial mount (see NodesList.jsx's identical pattern).
  const isFirstConnect = useRef(true)
  useEffect(() => {
    if (!connected) return
    if (isFirstConnect.current) {
      isFirstConnect.current = false
      return
    }
    reloadDevices()
  }, [connected])

  const devicesWithLive = (devices ?? []).map((device) => {
    const metadata = deviceMetadata[device.id]
    const liveNode = device.node_id !== null ? liveNodes[device.node_id] : undefined
    if (!metadata && !liveNode) return device
    return {
      ...device,
      ...metadata,
      ...(liveNode && { node_name: liveNode.name, node_simulated: liveNode.simulated }),
    }
  })

  const filtered = devicesWithLive
    .filter((device) => matchesSearch(device, search))
    .filter(
      (device) => !groupFilter || (device.device_group_ids ?? []).includes(Number(groupFilter)),
    )
    .filter((device) => !nodeFilter || String(device.node_id) === nodeFilter)
    .filter((device) => !statusFilter || (deviceRowColor(device) || 'ok') === statusFilter)
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: pageState.pageSize,
    onPageSizeChange: (size) => setPageState({ pageSize: size }),
  })

  const hasActiveFilters =
    Boolean(search) || Boolean(groupFilter) || Boolean(nodeFilter) || Boolean(statusFilter)
  const handleResetFilters = () => {
    setPageState({ search: '', groupFilter: '', nodeFilter: '', statusFilter: '' })
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
            <CRow className="mb-2 mx-1  g-2 align-items-center">
              <CCol xs="auto">
                <CFormSelect
                  size="sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filter by status"
                >
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </CFormSelect>
              </CCol>
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
                      <CTableHeaderCell scope="col"></CTableHeaderCell>
                      <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Node</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Type</CTableHeaderCell>
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
                      const effectivelySimulated = deviceEffectivelySimulated(device)
                      return (
                        <DeviceRow
                          key={device.id}
                          device={device}
                          expanded={isExpanded(device.id)}
                          onToggleExpand={() => toggleOne(device.id)}
                          onToggleSimulated={() => handleToggleSimulated(device)}
                          onOpenSettings={() => setSettingsDevice(device)}
                          onSimulateValue={(value) => handleSimulateValue(device, value)}
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
