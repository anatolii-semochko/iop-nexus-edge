import React, { useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
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
import { useProcessLiveState } from '../../api/useLiveProcess'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import Switch from '../../components/Switch'
import ExpandAllToggleButton from '../../components/table/ExpandAllToggleButton'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import { usePagination } from '../../hooks/usePagination'
import ActiveBuzzerPanel from './ActiveBuzzerPanel'
import DataLoggerPanel from './DataLoggerPanel'
import HeartbeatControlPanel from './HeartbeatControlPanel'
import HeartbeatControlTestPanel from './HeartbeatControlTestPanel'
import ProcessSettingsModal from './ProcessSettingsModal'
import ResourceMonitorPanel from './ResourceMonitorPanel'
import TemperatureProcessPanel from './TemperatureProcessPanel'
import WemRow from './WemRow'

// process.kind -> its expandable detail component (AGENTS.md section 10).
// Same plain-map approach as DEVICE_TYPE_SIMULATORS/DEVICE_TYPE_CONTROLS in
// the Devices pages - temperature-control/-monitor share one panel,
// resource-monitor (section 21) has its own, active-buzzer (Active Zummer
// section) has its own.
export const KIND_PANELS = {
  'temperature-control': TemperatureProcessPanel,
  'temperature-monitor': TemperatureProcessPanel,
  'heartbeat-control': HeartbeatControlPanel,
  'heartbeat-control-test': HeartbeatControlTestPanel,
  'resource-monitor': ResourceMonitorPanel,
  'active-buzzer': ActiveBuzzerPanel,
  'data-logger': DataLoggerPanel,
}

const statusColor = (status) => (status === 'on' ? 'success' : 'secondary')

// Exactly the ON/OFF pair (order-independent) - the one action set this
// row renders as a Switch instead of a button-per-action (AGENTS.md
// section 26). Any other action set (the still-unimplemented START/PAUSE/
// STOP - AGENTS.md section 10) keeps the original button rendering below,
// unchanged and still there for exactly that future case, not deleted.
const isOnOffActions = (actions) =>
  actions.length === 2 && actions.includes('ON') && actions.includes('OFF')

// Fixed width so a button's content swapping between its label and a busy
// spinner never changes the button's own box size - letting it changed
// the "Actions" column's width for every row the instant one row's button
// went busy, which looked like the whole table jumping.
const ACTION_BUTTON_STYLE = { width: '4rem' }

const ProcessRow = ({
  process,
  expanded,
  onToggleExpand,
  onReload,
  onError,
  tabGroups,
  messageGroups,
  onGroupsChange,
  extraAction,
}) => {
  const live = useProcessLiveState(process.id)
  // `status` is a deliberately non-urgent, timer-only broadcast field
  // (AGENTS.md section 24) - `live.status` can lag the actual value by up
  // to a whole broadcast interval, which made the ON/OFF switch below
  // visibly snap back to its pre-click position right after every click.
  // The API route now forces an immediate broadcast right after the
  // action lands, so that lag is normally sub-second - but `status` below
  // still prefers `live.status` over `process.status` (REST), so
  // `optimisticStatus` MUST only be released once `live.status` itself
  // confirms the new value, not merely `process.status` (the REST reload
  // `onReload` triggers). Comparing against `process.status` too - an
  // earlier version of this did - let a stale `live.status` show through
  // for the remaining gap the instant the REST reload landed first,
  // producing a visible optimistic -> stale -> correct double-flip instead
  // of a single clean transition. Once released, an external change (a
  // safety cutoff, another operator) still wins as soon as the live
  // broadcast reports it, same as before.
  const [optimisticStatus, setOptimisticStatus] = useState(null)
  const pendingOptimisticStatus =
    optimisticStatus !== null && live.status !== optimisticStatus ? optimisticStatus : null
  const status = pendingOptimisticStatus ?? live.status ?? process.status
  const critical = live.critical ?? process.critical
  const warning = live.warning ?? process.warning
  // Error always wins over warning (AGENTS.md section 21) - a row is never
  // both, so this is a simple precedence pick, not two independent styles.
  const rowColor = critical ? 'danger' : warning ? 'warning' : undefined
  // Only actually rendered once the row is expanded (AGENTS.md section
  // 22) - see WemRow below, nested at the end of the detail panel.
  const messages = live.messages ?? process.messages ?? []
  // Which specific action is in flight, not a single shared boolean - only
  // the button the user actually clicked shows a spinner; the other one
  // (already disabled, since it matches the pre-click status) never did.
  const [busyAction, setBusyAction] = useState(null)
  const [settingsVisible, setSettingsVisible] = useState(false)

  const handleAction = async (action) => {
    setBusyAction(action)
    if (isOnOffActions(process.actions)) {
      setOptimisticStatus(action.toLowerCase())
    }
    try {
      await api.doProcessAction(process.id, action)
      onReload()
    } catch (err) {
      setOptimisticStatus(null)
      onError(err.message)
    } finally {
      setBusyAction(null)
    }
  }

  const Panel = KIND_PANELS[process.kind]
  // Messages now render *inside* the expanded detail panel itself (its
  // last piece, after Panel's own content - see WemRow.jsx), not as their
  // own always-visible row - so they can no longer make the collapsed
  // table jump when they appear/disappear, and the only row that can ever
  // follow the plain row is the panel row.
  const noBorderWhenExpanded = expanded && Panel ? 'border-bottom-0' : undefined

  return (
    <>
      <CTableRow color={rowColor}>
        <CTableDataCell className={noBorderWhenExpanded}>{process.name}</CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>{process.group_name}</CTableDataCell>
        <CTableDataCell className={noBorderWhenExpanded}>
          {status ? (
            <CBadge color={statusColor(status)}>{status.toUpperCase()}</CBadge>
          ) : (
            <CBadge color="info">Running</CBadge>
          )}
        </CTableDataCell>
        <CTableDataCell className={`text-end ${noBorderWhenExpanded ?? ''}`}>
          {/* Single row, right-aligned, left-to-right: on/off, settings,
              remove-from-dashboard, expand toggle - i.e. right-to-left
              detailsToggle/removeFromDashboard/settings/onOff, since that's
              the order the user actually reads it in. `flex-nowrap` keeps
              every control on one line instead of wrapping under a narrow
              column. */}
          <div className="d-flex justify-content-end align-items-center gap-1 flex-nowrap">
            {isOnOffActions(process.actions) ? (
              <Switch
                checked={status === 'on'}
                onChange={(next) => handleAction(next ? 'ON' : 'OFF')}
                disabled={busyAction !== null}
                ariaLabel={`${process.name} power`}
              />
            ) : (
              process.actions.map((action) => {
                const isCurrent = action.toLowerCase() === status
                return (
                  <CButton
                    key={action}
                    size="sm"
                    style={ACTION_BUTTON_STYLE}
                    color={isCurrent ? statusColor(status) : 'secondary'}
                    variant={isCurrent ? undefined : 'outline'}
                    disabled={busyAction !== null || isCurrent}
                    onClick={() => handleAction(action)}
                  >
                    {busyAction === action ? <CSpinner size="sm" /> : action}
                  </CButton>
                )
              })
            )}
            <IconButton
              icon={cilSettings}
              size="sm"
              center
              onClick={() => setSettingsVisible(true)}
              ariaLabel="Process settings"
            />
            {extraAction?.(process)}
            {Panel && <ExpandToggleButton expanded={expanded} onClick={onToggleExpand} />}
          </div>
        </CTableDataCell>
      </CTableRow>
      {expanded && Panel && (
        <CTableRow color={rowColor}>
          <CTableDataCell colSpan={4} className="p-0">
            <Panel process={process} onConfigChange={onReload} />
            <WemRow messages={messages} />
          </CTableDataCell>
        </CTableRow>
      )}
      <ProcessSettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        process={process}
        tabGroups={tabGroups}
        messageGroups={messageGroups}
        onSaved={onGroupsChange}
      />
    </>
  )
}

/**
 * Shared table body (filters + search + pagination + expandable rows) for
 * every Processes-page tab (AGENTS.md section 22 redesign) - extracted out
 * of the old single-tab ProcessesList.jsx so Dashboard/All/Controllable/
 * Permanent/each Tab Group tab all render through one implementation
 * instead of duplicating it six-plus times.
 *
 * `processes` is already scoped to whatever this tab means (the caller's
 * job, same client-side-filter style the page always used) - this
 * component only ever applies the filters below on top of that.
 *
 * `filters` (`{ search?, group?, type?, status? }`) is which controls to
 * actually render - a given tab declares its own combination
 * (ProcessesList.jsx's `TAB_FILTERS` map is the single place that decides
 * this), not a single on/off switch. `group`/`type`/`status` read/write
 * `groupFilter`/`typeFilter`/`statusFilter` + their `onXChange` callbacks;
 * when a flag is false the matching control isn't rendered and its filter
 * is skipped entirely, regardless of whatever stale value the prop might
 * still hold.
 *
 * The filter row always renders, even when the current filters match zero
 * processes - an earlier version returned the "no processes match" alert
 * *instead of* the whole component body, which took the filter controls
 * down with it the moment a filter combination produced an empty result,
 * leaving no way to change or clear whatever filter just caused that. Only
 * the table+pagination below the filter row is swapped for the empty-state
 * alert now.
 *
 * Persisted sub-state (`search`/`groupFilter`/`typeFilter`/`pageSize`) is
 * fully controlled by the caller - this component owns no persistence
 * itself, so every tab can keep its own independent state without this
 * component caring which cookie key or scoping any of that lives under.
 */
const ProcessesTable = ({
  processes,
  groups,
  filters = {},
  groupFilter = '',
  onGroupFilterChange,
  typeFilter = '',
  onTypeFilterChange,
  statusFilter = '',
  onStatusFilterChange,
  search,
  onSearchChange,
  searchResetToken,
  pageSize,
  onPageSizeChange,
  expandedIds,
  setExpandedIds,
  onReload,
  onError,
  tabGroups,
  messageGroups,
  onGroupsChange,
  onResetFilters,
  renderExtraRowAction,
  emptyMessage = 'No processes match this filter.',
}) => {
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)

  const filtered = processes.filter(
    (p) =>
      (!filters.group || !groupFilter || p.group_name === groupFilter) &&
      (!filters.type || !typeFilter || p.type === typeFilter) &&
      // A process with no `status` (permanent/system kinds - AGENTS.md
      // section 21) has no on/off state at all, so it's always "active"
      // here, same as the "Running" badge it always shows instead of
      // ON/OFF - only an explicit 'off' counts as inactive.
      (!filters.status ||
        !statusFilter ||
        (statusFilter === 'active' ? p.status !== 'off' : p.status === 'off')) &&
      (!filters.search || !search || p.name.toLowerCase().includes(search.toLowerCase())),
  )
  const {
    page,
    pageSize: currentPageSize,
    pageItems,
    totalItems,
    setPage,
    setPageSize,
  } = usePagination(filtered, {
    pageSize,
    onPageSizeChange,
  })

  // "Expand/collapse all" (ExpandAllToggleButton, in the header) only ever
  // considers the current page's rows that actually have a panel
  // (KIND_PANELS) - toggling doesn't touch rows on other pages, matching
  // what's actually visible.
  const expandableIds = pageItems.filter((p) => KIND_PANELS[p.kind]).map((p) => p.id)

  const hasActiveFilters =
    (filters.search && Boolean(search)) ||
    (filters.group && Boolean(groupFilter)) ||
    (filters.type && Boolean(typeFilter)) ||
    (filters.status && Boolean(statusFilter))

  return (
    <>
      <CRow className="mb-3 g-2 align-items-center">
        {filters.group && (
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={groupFilter}
              onChange={(e) => onGroupFilterChange(e.target.value)}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </CFormSelect>
          </CCol>
        )}
        {filters.type && (
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange(e.target.value)}
            >
              <option value="">All types</option>
              <option value="controllable">Controllable</option>
              <option value="permanent">Permanent</option>
            </CFormSelect>
          </CCol>
        )}
        {filters.status && (
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </CFormSelect>
          </CCol>
        )}
        {filters.search && (
          <CCol xs="auto">
            <TableSearchInput
              key={searchResetToken}
              value={search}
              onSearch={onSearchChange}
              placeholder="Search by name..."
            />
          </CCol>
        )}
        {/* Pushed to the far right of this same row, not the tab strip
            above it - a plain (non-`xs="auto"`) CCol takes the remaining
            row width, and this inner flex box right-aligns within it. */}
        <CCol className="d-flex justify-content-end">
          <ResetFiltersButton active={hasActiveFilters} onClick={onResetFilters} />
        </CCol>
      </CRow>
      {filtered.length === 0 ? (
        <CAlert color="info">{emptyMessage}</CAlert>
      ) : (
        <>
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                <CTableHeaderCell scope="col">Group</CTableHeaderCell>
                <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                <CTableHeaderCell scope="col" className="text-end">
                  <div className="d-flex justify-content-end align-items-center gap-2">
                    <span>Actions</span>
                    <ExpandAllToggleButton
                      ids={expandableIds}
                      expandedIds={expandedIds}
                      setExpandedIds={setExpandedIds}
                    />
                  </div>
                </CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {pageItems.map((process) => (
                <ProcessRow
                  key={process.id}
                  process={process}
                  expanded={isExpanded(process.id)}
                  onToggleExpand={() => toggleOne(process.id)}
                  onReload={onReload}
                  onError={onError}
                  tabGroups={tabGroups}
                  messageGroups={messageGroups}
                  onGroupsChange={onGroupsChange}
                  extraAction={renderExtraRowAction}
                />
              ))}
            </CTableBody>
          </CTable>
          <TablePagination
            page={page}
            pageSize={currentPageSize}
            totalItems={totalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </>
  )
}

export default ProcessesTable
