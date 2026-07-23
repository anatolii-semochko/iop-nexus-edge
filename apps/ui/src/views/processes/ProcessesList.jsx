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
import { api } from '../../api/client'
import { useProcessLiveState } from '../../api/useLiveProcess'
import LiveBadge from '../devices/LiveBadge'
import TemperatureProcessPanel from './TemperatureProcessPanel'

// process.kind -> its expandable detail component (AGENTS.md section 10).
// Only one kind-pair exists today (temperature-control/-monitor share the
// same panel), same plain-map approach as DEVICE_TYPE_SIMULATORS/
// DEVICE_TYPE_CONTROLS in the Devices pages.
const KIND_PANELS = {
  'temperature-control': TemperatureProcessPanel,
  'temperature-monitor': TemperatureProcessPanel,
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

  return (
    <>
      <CTableRow color={critical ? 'danger' : undefined}>
        <CTableDataCell>{process.name}</CTableDataCell>
        <CTableDataCell>{process.group_name}</CTableDataCell>
        <CTableDataCell>
          {status ? (
            <CBadge color={statusColor(status)}>{status.toUpperCase()}</CBadge>
          ) : (
            <CBadge color="info">Running</CBadge>
          )}
        </CTableDataCell>
        <CTableDataCell className="text-end">
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
        <CTableDataCell className="text-end" style={{ width: '2rem' }}>
          {Panel && (
            <CButton size="sm" color="link" className="p-0" onClick={onToggleExpand}>
              {expanded ? '▾' : '▸'}
            </CButton>
          )}
        </CTableDataCell>
      </CTableRow>
      {expanded && Panel && (
        <CTableRow color={critical ? 'danger' : undefined}>
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
  const [error, setError] = useState(null)
  const [groupFilter, setGroupFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())

  const reload = () => {
    api
      .listProcesses()
      .then((all) => {
        setProcesses(all)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(reload, [])

  if (error && !processes) return <CAlert color="danger">{error}</CAlert>
  if (!processes) return <CSpinner color="primary" />

  const groups = [...new Set(processes.map((p) => p.group_name))].sort()
  const filtered = processes.filter(
    (p) => (!groupFilter || p.group_name === groupFilter) && (!typeFilter || p.type === typeFilter),
  )

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
        <strong>Processes</strong> <LiveBadge />
      </CCardHeader>
      <CCardBody>
        <CRow className="mb-3 g-2">
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              <option value="controllable">Controllable</option>
              <option value="permanent">Permanent</option>
            </CFormSelect>
          </CCol>
        </CRow>
        {filtered.length === 0 ? (
          <CAlert color="info">No processes match this filter.</CAlert>
        ) : (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                <CTableHeaderCell scope="col">Group</CTableHeaderCell>
                <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                <CTableHeaderCell scope="col" className="text-end">
                  Actions
                </CTableHeaderCell>
                <CTableHeaderCell scope="col" />
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {filtered.map((process) => (
                <ProcessRow
                  key={process.id}
                  process={process}
                  expanded={expandedIds.has(process.id)}
                  onToggleExpand={() => toggleExpand(process.id)}
                  onReload={reload}
                  onError={setError}
                />
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default ProcessesList
