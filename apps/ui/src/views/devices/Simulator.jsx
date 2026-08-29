import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CCard,
  CCardBody,
  CCardHeader,
  CSpinner,
  CToast,
  CToastBody,
  CToastClose,
  CToaster,
} from '@coreui/react'
import { api } from '../../api/client'
import { usePersistedState } from '../../hooks/usePersistedState'
import LiveBadge from './LiveBadge'
import ProcessesTable from '../processes/ProcessesTable'

// Registration for usePersistedState - separate key from
// 'nexusedge.processesPage' (ProcessesList.jsx), own independent filter/
// pagination/expand state.
const PERSISTED_DEFAULTS = {
  search: '',
  groupFilter: '',
  statusFilter: '',
  pageSize: 10,
  expandedIds: [],
}

/**
 * Simulator page (AGENTS_TO_DO.md, 2026-08-29 "СИМУЛЯЦІЯ", replaces the
 * old "Dev Simulator" - that page's own per-device Mode/Auto/Override
 * editing moved into DevicesList.jsx's own expand row Value tab instead,
 * see that file's own DeviceDetailRow). Shows only `type: 'simulation'`
 * processes (Phase 0's own new processes.type value) through the exact
 * same ProcessesTable/WemRow machinery the Processes page's own tabs use
 * - status column, colored row on critical/warning, ON/OFF switch (every
 * simulation process is seeded with `actions: ['ON', 'OFF']` for exactly
 * this), expand button + per-kind Panel (processTypeRegistry), filters +
 * search. No tabs of its own - one flat, always-filtered-to-simulation
 * list, unlike the Processes page's Dashboard/All/Controllable/etc tabs.
 */
const Simulator = () => {
  const [processes, setProcesses] = useState(null)
  const [groups, setGroups] = useState([])
  const [tabGroups, setTabGroups] = useState([])
  const [messageGroups, setMessageGroups] = useState([])
  const [error, setError] = useState(null)
  const [pageState, setPageState] = usePersistedState('nexusedge.simulatorPage', PERSISTED_DEFAULTS)
  const { search, groupFilter, statusFilter, pageSize, expandedIds } = pageState
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const [searchResetToken, setSearchResetToken] = useState(0)

  const reload = () => {
    api
      .listProcesses()
      .then((all) => {
        setProcesses(all.filter((p) => p.type === 'simulation'))
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  // ProcessesTable's own ProcessRow always renders the generic Settings
  // popup (Tab/Message Group membership) regardless of kind - same
  // dependencies as ProcessesList.jsx's own reloadGroupMemberships.
  const reloadGroupMemberships = () => {
    api
      .listTabGroups()
      .then(setTabGroups)
      .catch(() => {})
    api
      .listMessageGroups()
      .then(setMessageGroups)
      .catch(() => {})
  }

  useEffect(reload, [])
  useEffect(() => {
    api
      .listProcessGroups()
      .then(setGroups)
      .catch((err) => setError(err.message))
  }, [])
  useEffect(reloadGroupMemberships, [])

  if (error && !processes) return <CAlert color="danger">{error}</CAlert>
  if (!processes) return <CSpinner color="primary" />

  const handleResetFilters = () => {
    setPageState({ search: '', groupFilter: '', statusFilter: '' })
    setSearchResetToken((t) => t + 1)
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
        <strong>Simulator</strong> <LiveBadge />
      </CCardHeader>
      <CCardBody>
        <ProcessesTable
          processes={processes}
          groups={groups}
          filters={{ search: true, group: true, status: true }}
          search={search}
          onSearchChange={(value) => setPageState({ search: value })}
          groupFilter={groupFilter}
          onGroupFilterChange={(value) => setPageState({ groupFilter: value })}
          statusFilter={statusFilter}
          onStatusFilterChange={(value) => setPageState({ statusFilter: value })}
          searchResetToken={searchResetToken}
          pageSize={pageSize}
          onPageSizeChange={(size) => setPageState({ pageSize: size })}
          expandedIds={expandedIds}
          setExpandedIds={setExpandedIds}
          onReload={reload}
          onError={setError}
          tabGroups={tabGroups}
          messageGroups={messageGroups}
          onGroupsChange={reloadGroupMemberships}
          onResetFilters={handleResetFilters}
          // No separate "Power" column - the Status column below already
          // folds the switch's own on/off into Off/Sleep/Active/Error
          // (AGENTS_TO_DO.md, 2026-08-29), the ON/OFF badge would just
          // repeat it.
          showPower={false}
          // Off / Sleep / Active - three states, not the generic "OK"
          // (AGENTS_TO_DO.md, 2026-08-29, corrected spec): Off is the
          // operator's own switch turned off, full stop - Sleep and Active
          // only apply while the operator has it ON, split further by
          // whether the target Node/Device is currently in simulated mode
          // (simulationTargetSimulated, apps/api's simulationTarget.ts) -
          // matches exactly what the orchestrator's own runner gates on,
          // so "Active" never claims something is running when it isn't.
          // Error/Warning (critical/warning) still win over Sleep/Active -
          // RowStatusBadge only falls back to this for the "nothing
          // wrong" case - but never over Off, see overrideRowColor below.
          statusLabel={(process, { status, simulationTargetSimulated }) => {
            if (status !== 'on') return { text: 'Off', color: 'secondary' }
            return simulationTargetSimulated
              ? { text: 'Active', color: 'success' }
              : { text: 'Sleep', color: 'secondary' }
          }}
          // "Off means fully inert" (AGENTS_TO_DO.md, 2026-08-29: "процес
          // і його статус не реагують на інші процеси і статуси ніяк") -
          // an operator-off process shows neither a leftover error tint
          // nor label from before it was switched off; forces no row
          // color while off, otherwise leaves the computed value (still
          // respects critical/warning while genuinely running) untouched.
          overrideRowColor={(process, { status, rowColor }) =>
            status !== 'on' ? undefined : rowColor
          }
          emptyMessage={
            processes.length === 0
              ? 'No simulation processes registered yet.'
              : 'No simulation processes match this filter.'
          }
        />
      </CCardBody>
    </CCard>
  )
}

export default Simulator
