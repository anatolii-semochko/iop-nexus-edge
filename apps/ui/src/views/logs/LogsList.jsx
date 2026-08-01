import React, { useEffect, useState } from 'react'
import { CCard, CCardBody, CCardHeader, CTab, CTabList, CTabs } from '@coreui/react'
import { api } from '../../api/client'
import { usePersistedState } from '../../hooks/usePersistedState'
import CommandLogsTab from './CommandLogsTab'
import DeviceLogsTab from './DeviceLogsTab'
import ProcessMessageLogsTab from './ProcessMessageLogsTab'

const TAB_DEFS = [
  { key: 'commands', label: 'Commands' },
  { key: 'devices', label: 'Devices' },
  { key: 'processes', label: 'Messages' },
]

// Registration for usePersistedState (AGENTS_TO_DO.md, 2026-08-01) -
// tabbed variant, ProcessesList.jsx's own pattern (`activeTab` + `perTab`)
// - but unlike that page, these three tabs do NOT share one common filter
// shape (Commands has device/action/actor/date-range, Devices has just
// device/date-range, Messages has type/process/date-range), so each tab
// key gets its OWN default shape here instead of one shared
// DEFAULT_TAB_STATE. `page` itself is never persisted (AGENTS.md section
// 17), only `pageSize`.
const TAB_DEFAULTS = {
  commands: {
    deviceId: '',
    action: '',
    actorUserId: '',
    search: '',
    from: '',
    to: '',
    pageSize: 20,
  },
  devices: {
    deviceId: '',
    search: '',
    from: '',
    to: '',
    pageSize: 20,
  },
  processes: {
    type: 'all',
    processId: '',
    search: '',
    from: '',
    to: '',
    pageSize: 20,
  },
}

const PERSISTED_DEFAULTS = {
  activeTab: 'commands',
  perTab: {},
}

/**
 * Logs page (AGENTS.md section 29/36) - a tabbed historical browser over
 * the three append-only log tables (log_command, log_device, log_messages -
 * renamed from device_command_logs/sensor_reading_logs/process_messages,
 * AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor), following the same
 * CTabs/CTabList pattern as the Processes page (section 22) rather than
 * CTabContent/CTabPanel, so an inactive tab doesn't keep fetching/
 * pagination state mounted for no reason - each tab component genuinely
 * unmounts on switch, so its `useServerPaginatedList` call re-seeds
 * `pageSize` fresh from `tabState(key)` every time it remounts, no
 * separate re-sync effect needed for that. Devices/processes/users are
 * fetched once here (cheap, a few dozen rows) and passed down for each
 * tab's own selector dropdown. Filters/search/date-range/pageSize per
 * tab, and which tab is active, persist across a refresh (2026-08-01) -
 * lifted up here from each tab component's own local state, mirroring
 * ProcessesList.jsx's `perTab` pattern, and passed back down as controlled
 * props (same prop-per-field convention as ProcessesTable.jsx).
 */
const LogsList = () => {
  const [devices, setDevices] = useState([])
  const [processes, setProcesses] = useState([])
  const [users, setUsers] = useState([])
  // Bumped on "reset filters" to force the active tab's TableSearchInput
  // to remount with a blank value - same reasoning as ProcessesList.jsx's
  // identical field.
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [pageState, setPageState] = usePersistedState('nexusedge.logsPage', PERSISTED_DEFAULTS)
  const { activeTab } = pageState
  const setActiveTab = (key) => setPageState({ activeTab: key })

  // usePersistedState only merges top-level cookie keys (see its own doc
  // comment) - a `perTab` entry for a tab key that didn't exist yet when
  // the cookie was last written needs its own fallback here, not just the
  // hook's own defaulting (ProcessesList.jsx's identical caveat).
  const tabState = (key) => ({ ...TAB_DEFAULTS[key], ...pageState.perTab[key] })
  const setTabState = (key, partial) =>
    setPageState({ perTab: { ...pageState.perTab, [key]: { ...tabState(key), ...partial } } })
  const resetTab = (key) => {
    setPageState({ perTab: { ...pageState.perTab, [key]: TAB_DEFAULTS[key] } })
    setSearchResetToken((t) => t + 1)
  }

  useEffect(() => {
    api
      .listDevices()
      .then(setDevices)
      .catch(() => {})
  }, [])
  useEffect(() => {
    api
      .listProcesses()
      .then(setProcesses)
      .catch(() => {})
  }, [])
  useEffect(() => {
    api
      .listUserDirectory()
      .then(setUsers)
      .catch(() => {})
  }, [])

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Logs</strong>
      </CCardHeader>
      <CCardBody>
        <CTabs activeItemKey={activeTab} onChange={setActiveTab}>
          <CTabList variant="tabs" className="mb-3">
            {TAB_DEFS.map((tab) => (
              <CTab key={tab.key} itemKey={tab.key}>
                {tab.label}
              </CTab>
            ))}
          </CTabList>
        </CTabs>
        {activeTab === 'commands' && (
          <CommandLogsTab
            devices={devices}
            users={users}
            {...tabState('commands')}
            onDeviceIdChange={(value) => setTabState('commands', { deviceId: value })}
            onActionChange={(value) => setTabState('commands', { action: value })}
            onActorUserIdChange={(value) => setTabState('commands', { actorUserId: value })}
            onSearchChange={(value) => setTabState('commands', { search: value })}
            onFromChange={(value) => setTabState('commands', { from: value })}
            onToChange={(value) => setTabState('commands', { to: value })}
            onPageSizeChange={(value) => setTabState('commands', { pageSize: value })}
            searchResetToken={searchResetToken}
            onResetFilters={() => resetTab('commands')}
          />
        )}
        {activeTab === 'devices' && (
          <DeviceLogsTab
            devices={devices}
            {...tabState('devices')}
            onDeviceIdChange={(value) => setTabState('devices', { deviceId: value })}
            onSearchChange={(value) => setTabState('devices', { search: value })}
            onFromChange={(value) => setTabState('devices', { from: value })}
            onToChange={(value) => setTabState('devices', { to: value })}
            onPageSizeChange={(value) => setTabState('devices', { pageSize: value })}
            searchResetToken={searchResetToken}
            onResetFilters={() => resetTab('devices')}
          />
        )}
        {activeTab === 'processes' && (
          <ProcessMessageLogsTab
            processes={processes}
            {...tabState('processes')}
            onTypeChange={(value) => setTabState('processes', { type: value })}
            onProcessIdChange={(value) => setTabState('processes', { processId: value })}
            onSearchChange={(value) => setTabState('processes', { search: value })}
            onFromChange={(value) => setTabState('processes', { from: value })}
            onToChange={(value) => setTabState('processes', { to: value })}
            onPageSizeChange={(value) => setTabState('processes', { pageSize: value })}
            searchResetToken={searchResetToken}
            onResetFilters={() => resetTab('processes')}
          />
        )}
      </CCardBody>
    </CCard>
  )
}

export default LogsList
