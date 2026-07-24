import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
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
  CToast,
  CToastBody,
  CToastClose,
  CToaster,
} from '@coreui/react'
import { cilFilterX, cilGroup } from '@coreui/icons'
import { api } from '../../api/client'
import { useProcessLiveState } from '../../api/useLiveProcess'
import IconButton from '../../components/IconButton'
import ManageNamedListModal from '../../components/ManageNamedListModal'
import ExpandAllToggleButton from '../../components/table/ExpandAllToggleButton'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import { usePagination } from '../../hooks/usePagination'
import { usePersistedState } from '../../hooks/usePersistedState'
import LiveBadge from '../devices/LiveBadge'
import ResourceMonitorPanel from './ResourceMonitorPanel'
import TemperatureProcessPanel from './TemperatureProcessPanel'

// Registration for usePersistedState (AGENTS.md section 17) - these five
// fields, and only these, survive a refresh; every key's value here is
// also its default for a first-ever visit.
const PERSISTED_DEFAULTS = {
  groupFilter: '',
  typeFilter: '',
  search: '',
  pageSize: 10,
  expandedIds: [],
}

// process.kind -> its expandable detail component (AGENTS.md section 10).
// Same plain-map approach as DEVICE_TYPE_SIMULATORS/DEVICE_TYPE_CONTROLS in
// the Devices pages - temperature-control/-monitor share one panel,
// resource-monitor (section 21) has its own.
const KIND_PANELS = {
  'temperature-control': TemperatureProcessPanel,
  'temperature-monitor': TemperatureProcessPanel,
  'resource-monitor': ResourceMonitorPanel,
}

const statusColor = (status) => (status === 'on' ? 'success' : 'secondary')

// Fixed width so a button's content swapping between its label and a busy
// spinner never changes the button's own box size - letting it changed
// the "Actions" column's width for every row the instant one row's button
// went busy, which looked like the whole table jumping.
const ACTION_BUTTON_STYLE = { width: '4rem' }

const ProcessRow = ({ process, expanded, onToggleExpand, onReload, onError }) => {
  const live = useProcessLiveState(process.id)
  const status = live.status ?? process.status
  const critical = live.critical ?? process.critical
  const warning = live.warning ?? process.warning
  // Error always wins over warning (AGENTS.md section 21) - a row is never
  // both, so this is a simple precedence pick, not two independent styles.
  const rowColor = critical ? 'danger' : warning ? 'warning' : undefined
  // Which specific action is in flight, not a single shared boolean - only
  // the button the user actually clicked shows a spinner; the other one
  // (already disabled, since it matches the pre-click status) never did.
  const [busyAction, setBusyAction] = useState(null)

  const handleAction = async (action) => {
    setBusyAction(action)
    try {
      await api.doProcessAction(process.id, action)
      onReload()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusyAction(null)
    }
  }

  const Panel = KIND_PANELS[process.kind]
  // While a row is expanded, its own bottom border would sit right between
  // it and its detail panel, reading as an odd extra divider inside what's
  // visually one block - drop it there and let the panel row's own bottom
  // border be the only line, separating this whole process from the next.
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
          {process.actions.map((action) => {
            const isCurrent = action.toLowerCase() === status
            return (
              <CButton
                key={action}
                size="sm"
                style={ACTION_BUTTON_STYLE}
                color={isCurrent ? statusColor(status) : 'secondary'}
                variant={isCurrent ? undefined : 'outline'}
                disabled={busyAction !== null || isCurrent}
                className="ms-1"
                onClick={() => handleAction(action)}
              >
                {busyAction === action ? <CSpinner size="sm" /> : action}
              </CButton>
            )
          })}
        </CTableDataCell>
        <CTableDataCell
          className={`text-end ${noBorderWhenExpanded ?? ''}`}
          style={{ width: '2rem' }}
        >
          {Panel && <ExpandToggleButton expanded={expanded} onClick={onToggleExpand} />}
        </CTableDataCell>
      </CTableRow>
      {expanded && Panel && (
        <CTableRow color={rowColor}>
          <CTableDataCell colSpan={5} className="p-0">
            <Panel process={process} onConfigChange={onReload} />
          </CTableDataCell>
        </CTableRow>
      )}
    </>
  )
}

/**
 * Processes page (AGENTS.md section 10 - first orchestration step): every
 * process, filterable by group/type, expandable per-row detail component.
 * A process's config (min/max) reload just re-fetches the whole list -
 * same "load()" pattern as apps/ui/src/views/devices/DevSimulator.jsx -
 * rather than patching local state, since the list is small and this
 * keeps the row and its expanded panel from ever disagreeing.
 */
const ProcessesList = () => {
  const [processes, setProcesses] = useState(null)
  const [groups, setGroups] = useState([])
  const [groupsModalVisible, setGroupsModalVisible] = useState(false)
  // Bumped on "reset filters" to force TableSearchInput to remount with a
  // blank value - it deliberately owns its own typing state after mount
  // (AGENTS.md section 11), so an external setPageState({search: ''}) alone
  // wouldn't clear what's actually showing in the box.
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [error, setError] = useState(null)
  const [pageState, setPageState] = usePersistedState('nexusedge.processes', PERSISTED_DEFAULTS)
  const { groupFilter, typeFilter, search, expandedIds } = pageState
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)

  const reload = () => {
    api
      .listProcesses()
      .then((all) => {
        setProcesses(all)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  const reloadGroups = () => {
    api
      .listProcessGroups()
      .then(setGroups)
      .catch((err) => setError(err.message))
  }

  useEffect(reload, [])
  useEffect(reloadGroups, [])

  const hasActiveFilters = Boolean(groupFilter || typeFilter || search)
  const handleResetFilters = () => {
    setPageState({ groupFilter: '', typeFilter: '', search: '' })
    setSearchResetToken((t) => t + 1)
  }

  // Hooks must run unconditionally on every render, so pagination is
  // computed here (against a safe `[]` fallback before data loads) rather
  // than after the early error/loading returns below.
  const filtered = (processes ?? []).filter(
    (p) =>
      (!groupFilter || p.group_name === groupFilter) &&
      (!typeFilter || p.type === typeFilter) &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase())),
  )
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: pageState.pageSize,
    onPageSizeChange: (size) => setPageState({ pageSize: size }),
  })

  if (error && !processes) return <CAlert color="danger">{error}</CAlert>
  if (!processes) return <CSpinner color="primary" />

  // "Expand/collapse all" (ExpandAllToggleButton, in the header) only ever
  // considers the current page's rows that actually have a panel
  // (KIND_PANELS) - toggling doesn't touch rows on other pages, matching
  // what's actually visible.
  const expandableIds = pageItems.filter((p) => KIND_PANELS[p.kind]).map((p) => p.id)

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
        <strong>Processes</strong> <LiveBadge />
      </CCardHeader>
      <CCardBody>
        <CRow className="mb-3 g-2 align-items-center">
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={groupFilter}
              onChange={(e) => setPageState({ groupFilter: e.target.value })}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={typeFilter}
              onChange={(e) => setPageState({ typeFilter: e.target.value })}
            >
              <option value="">All types</option>
              <option value="controllable">Controllable</option>
              <option value="permanent">Permanent</option>
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <TableSearchInput
              key={searchResetToken}
              value={search}
              onSearch={(value) => setPageState({ search: value })}
              placeholder="Search by name..."
            />
          </CCol>
          {/* Right-aligned action-button block (AGENTS.md section 17) - the
              filter row's own convention: filters flow left to right,
              per-page actions sit in this last, flex-end column. */}
          <CCol className="d-flex justify-content-end gap-2">
            <IconButton
              icon={cilGroup}
              onClick={() => setGroupsModalVisible(true)}
              ariaLabel="Manage groups"
            />
            {hasActiveFilters && (
              <IconButton
                icon={cilFilterX}
                color="warning"
                variant={undefined}
                onClick={handleResetFilters}
                ariaLabel="Reset filters"
              />
            )}
          </CCol>
        </CRow>
        {filtered.length === 0 ? (
          <CAlert color="info">No processes match this filter.</CAlert>
        ) : (
          <>
            <CTable responsive>
              <CTableHead>
                <CTableRow>
                  <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Group</CTableHeaderCell>
                  <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                  <CTableHeaderCell scope="col" className="text-end">
                    Actions
                  </CTableHeaderCell>
                  <CTableHeaderCell scope="col" className="text-end">
                    <ExpandAllToggleButton
                      ids={expandableIds}
                      expandedIds={expandedIds}
                      setExpandedIds={setExpandedIds}
                    />
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
                    onReload={reload}
                    onError={setError}
                  />
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
      </CCardBody>
      <ManageNamedListModal
        visible={groupsModalVisible}
        onClose={() => setGroupsModalVisible(false)}
        title="Groups"
        addLabel="Add Group"
        namePlaceholder="Group name"
        items={groups}
        onAdd={async (name) => {
          await api.createProcessGroup(name)
          reloadGroups()
        }}
        onRename={async (id, name) => {
          await api.renameProcessGroup(id, name)
          reloadGroups()
          reload()
        }}
        onDelete={async (id) => {
          await api.deleteProcessGroup(id)
          reloadGroups()
        }}
      />
    </CCard>
  )
}

export default ProcessesList
