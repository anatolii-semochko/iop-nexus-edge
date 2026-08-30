import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CCard,
  CCardBody,
  CCardHeader,
  CSpinner,
  CTab,
  CTabList,
  CTabs,
  CToast,
  CToastBody,
  CToastClose,
  CToaster,
} from '@coreui/react'
import { api } from '../../api/client'
import { usePersistedState } from '../../hooks/usePersistedState'
import LiveBadge from '../devices/LiveBadge'
import DashboardTab from './DashboardTab'
import ProcessesTable from './ProcessesTable'
import SettingsTab from './SettingsTab'

// Registration for usePersistedState (AGENTS.md section 22) - a separate,
// independent registration from the older 'nexusedge.processes' key
// (still used nowhere now, but deliberately left alone/generic rather than
// repurposed, so a future page can register its own the same way).
// `perTab` is keyed by tab key ('all', 'controllable', 'permanent', or
// `tg:${tabGroupId}` for a dynamic Tab Group tab) -> { search, pageSize,
// groupFilter, typeFilter, statusFilter } - every listing tab has its own independent
// slice (no more single top-level `groupFilter`, since every tab can now
// filter by Process Group, not just "All"). `expandedIds` is deliberately
// NOT per-tab - the same process/detail-panel either way, regardless of
// which tab it's viewed from.
const PERSISTED_DEFAULTS = {
  activeTab: 'all',
  expandedIds: [],
  perTab: {},
}

// Process management (AGENTS_TO_DO.md, 2026-08-14) - how often the
// "pending restart" badge re-checks the orchestrator's own live registered-
// kinds list. 10s, not tied to TICK_INTERVAL_MS (orchestrator-side,
// 1s) - this is a UI convenience poll, not a control loop.
const REGISTERED_KINDS_POLL_MS = 10000

const DEFAULT_TAB_STATE = {
  search: '',
  pageSize: 10,
  groupFilter: '',
  typeFilter: '',
  statusFilter: '',
}

// Which filter controls a given tab shows (AGENTS.md section 22) - the
// single place that decides this, so changing a tab's filter bar later is
// a one-line edit here, nowhere else. Dashboard is search-only (see
// DashboardTab.jsx's own FILTERS); Settings has no listing at all. Any tab
// key not listed here - i.e. every dynamic `tg:*` Tab Group tab - falls
// back to the same combination as 'all'.
const TAB_FILTERS = {
  all: { search: true, group: true, type: true, status: true },
  controllable: { search: true, group: true, type: true, status: true },
  permanent: { search: true, group: true, type: true, status: true },
}
const filtersFor = (tabKey) => TAB_FILTERS[tabKey] ?? TAB_FILTERS.all

/**
 * Processes page (AGENTS.md section 10/22) - a tabbed workspace: Dashboard
 * (processes that have ever had active WEM), All (filterable table), one
 * dynamic tab per admin-defined Tab Group, Controllable, Permanent, and
 * Settings (Process Groups + Tab Groups + Message Groups + Message Levels
 * config). The actual table/filter/pagination/expand rendering lives in
 * ProcessesTable.jsx, reused by every tab here rather than duplicated.
 */
const ProcessesList = () => {
  const [processes, setProcesses] = useState(null)
  const [registeredKinds, setRegisteredKinds] = useState(null)
  const [groups, setGroups] = useState([])
  const [tabGroups, setTabGroups] = useState([])
  const [messageGroups, setMessageGroups] = useState([])
  // Bumped on "reset filters" to force the active tab's TableSearchInput
  // to remount with a blank value - it deliberately owns its own typing
  // state after mount (AGENTS.md section 11), so an external state clear
  // alone wouldn't clear what's actually showing in the box.
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [error, setError] = useState(null)
  const [pageState, setPageState] = usePersistedState('nexusedge.processesPage', PERSISTED_DEFAULTS)
  const { activeTab, expandedIds } = pageState
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const setActiveTab = (key) => setPageState({ activeTab: key })

  // usePersistedState only merges top-level cookie keys (see its own doc
  // comment) - a `perTab` entry for a tab that didn't exist yet when the
  // cookie was last written needs its own fallback here, not just the
  // hook's own defaulting.
  const tabState = (key) => pageState.perTab[key] ?? DEFAULT_TAB_STATE
  const setTabState = (key, partial) =>
    setPageState({ perTab: { ...pageState.perTab, [key]: { ...tabState(key), ...partial } } })

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

  const reloadTabGroups = () => {
    api
      .listTabGroups()
      .then(setTabGroups)
      .catch((err) => setError(err.message))
  }

  const reloadMessageGroups = () => {
    api
      .listMessageGroups()
      .then(setMessageGroups)
      .catch((err) => setError(err.message))
  }

  // Per-process Settings popup edits both Tab Groups and Message Groups
  // membership at once (ProcessSettingsModal.jsx) - one combined reload
  // covers both rather than wiring two separate callbacks through every
  // layer down to that popup.
  const reloadGroupMemberships = () => {
    reloadTabGroups()
    reloadMessageGroups()
  }

  useEffect(reload, [])
  useEffect(reloadGroups, [])
  useEffect(reloadTabGroups, [])
  useEffect(reloadMessageGroups, [])

  // Process management (AGENTS_TO_DO.md, 2026-08-14) - polled, not
  // fetched once, so a row's "pending restart" badge (ProcessesTable.jsx)
  // clears on its own within REGISTERED_KINDS_POLL_MS of the orchestrator
  // actually restarting, without the operator needing to reload the page.
  useEffect(() => {
    const reloadRegisteredKinds = () => {
      api
        .getRegisteredProcessKinds()
        .then((res) => setRegisteredKinds(res.kinds))
        .catch(() => {
          // Tolerated silently - registeredKinds staying at its last-known
          // value (or null, pre-first-load) just means the "pending
          // restart" badge is momentarily stale, not worth surfacing as a
          // page-level error toast.
        })
    }
    reloadRegisteredKinds()
    const interval = setInterval(reloadRegisteredKinds, REGISTERED_KINDS_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  if (error && !processes) return <CAlert color="danger">{error}</CAlert>
  if (!processes) return <CSpinner color="primary" />

  // Reset lives in ProcessesTable's own filter row now (right-aligned,
  // next to the controls it actually clears), not up here next to the tab
  // strip - this just supplies the per-tab-key reset action.
  const handleResetFilters = (tabKey) => {
    setTabState(tabKey, { search: '', groupFilter: '', typeFilter: '', statusFilter: '' })
    setSearchResetToken((t) => t + 1)
  }

  const tabDefs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'all', label: 'All' },
    ...tabGroups.map((group) => ({ key: `tg:${group.id}`, label: group.name })),
    { key: 'controllable', label: 'Controllable' },
    { key: 'permanent', label: 'Permanent' },
    { key: 'settings', label: 'Settings' },
  ]

  const commonTableProps = (tabKey) => ({
    filters: filtersFor(tabKey),
    search: tabState(tabKey).search,
    onSearchChange: (value) => setTabState(tabKey, { search: value }),
    groupFilter: tabState(tabKey).groupFilter,
    onGroupFilterChange: (value) => setTabState(tabKey, { groupFilter: value }),
    typeFilter: tabState(tabKey).typeFilter,
    onTypeFilterChange: (value) => setTabState(tabKey, { typeFilter: value }),
    statusFilter: tabState(tabKey).statusFilter,
    onStatusFilterChange: (value) => setTabState(tabKey, { statusFilter: value }),
    groups,
    searchResetToken,
    pageSize: tabState(tabKey).pageSize,
    onPageSizeChange: (size) => setTabState(tabKey, { pageSize: size }),
    expandedIds,
    setExpandedIds,
    onReload: reload,
    onError: setError,
    tabGroups,
    messageGroups,
    onGroupsChange: reloadGroupMemberships,
    onResetFilters: () => handleResetFilters(tabKey),
    registeredKinds,
  })

  // A tab's own base scope (which processes it means in the first place) -
  // the *filters* above narrow that further, same client-side style this
  // page has always used.
  const scopedProcesses = () => {
    if (activeTab === 'controllable') return processes.filter((p) => p.type === 'controllable')
    if (activeTab === 'permanent') return processes.filter((p) => p.type === 'permanent')
    if (activeTab.startsWith('tg:')) {
      const groupId = Number(activeTab.slice(3))
      const group = tabGroups.find((g) => g.id === groupId)
      return group ? processes.filter((p) => group.processIds.includes(p.id)) : []
    }
    return processes
  }

  const renderActiveTab = () => {
    if (activeTab === 'dashboard') {
      return <DashboardTab processes={processes} {...commonTableProps('dashboard')} />
    }
    if (activeTab === 'settings') {
      return (
        <SettingsTab
          groups={groups}
          reloadGroups={reloadGroups}
          reloadProcesses={reload}
          tabGroups={tabGroups}
          reloadTabGroups={reloadTabGroups}
          messageGroups={messageGroups}
          reloadMessageGroups={reloadMessageGroups}
          onError={setError}
        />
      )
    }
    const emptyMessage = activeTab.startsWith('tg:')
      ? 'No processes are in this tab group yet.'
      : undefined
    return (
      <ProcessesTable
        processes={scopedProcesses()}
        emptyMessage={emptyMessage}
        {...commonTableProps(activeTab)}
      />
    )
  }

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
        {/* Flex, not just LiveBadge's own align-middle (AGENTS_TO_DO.md,
            2026-08-30) - see Simulator.jsx's own identical comment. */}
        <div className="d-flex align-items-center gap-2">
          <strong>Processes</strong>
          <LiveBadge />
        </div>
      </CCardHeader>
      <CCardBody>
        <CTabs activeItemKey={activeTab} onChange={setActiveTab}>
          <CTabList variant="tabs" className="mb-3">
            {tabDefs.map((tab) => (
              <CTab key={tab.key} itemKey={tab.key}>
                {tab.label}
              </CTab>
            ))}
          </CTabList>
        </CTabs>
        {renderActiveTab()}
      </CCardBody>
    </CCard>
  )
}

export default ProcessesList
