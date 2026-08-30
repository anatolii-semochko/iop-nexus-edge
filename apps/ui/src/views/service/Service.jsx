import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
  CTab,
  CTabList,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableRow,
  CTabs,
} from '@coreui/react'
import { api } from '../../api/client'
import { usePersistedState } from '../../hooks/usePersistedState'
import DatabaseTab from './DatabaseTab'

// Service page (AGENTS_TO_DO.md, 2026-08-30) - admin-only (server-side
// requireAdmin on every /service/* route, same pattern as UsersList.jsx's
// own /users routes - this page has no extra client-side guard beyond
// that, it trusts the 403). Tabs will grow (user's own "буде
// розширюватися") - Config is still a placeholder, Database and Commands
// are both real now.
const TABS = [
  { key: 'config', label: 'Config' },
  { key: 'database', label: 'Database' },
  { key: 'commands', label: 'Commands' },
]

const PLACEHOLDER_TABS = new Set(['config'])

// A real <table> (AGENTS_TO_DO.md, 2026-08-30 correction: the earlier
// row/col-3/col-8 grid pinned the button column to a fixed 25% of the
// container regardless of what the labels actually needed - "Shutdown"/
// "Restart" ended up disproportionately wide with dead space, not sized
// to their own content) - a table's own column-width behavior sizes the
// button column to its widest cell and every row shares that width, so
// buttons come out consistently sized without a hardcoded fraction. The
// "disabled" badge stays in the description cell (prefixing the text)
// rather than the button cell - keeping it there would make the button
// column's own auto-width fight between rows that have a badge and rows
// that don't.
const CommandRow = ({ command, onRun }) => (
  <CTableRow>
    <CTableDataCell>
      <CButton
        className={'w-100'}
        color={command.enabled ? 'danger' : 'secondary'}
        variant="outline"
        disabled={!command.enabled}
        onClick={() => onRun(command)}
      >
        {command.label}
      </CButton>
    </CTableDataCell>
    <CTableDataCell className="text-body-secondary small align-middle w-100">
      {!command.enabled && (
        <CBadge color="secondary" className="me-3">
          disabled
        </CBadge>
      )}
      {command.description}
    </CTableDataCell>
  </CTableRow>
)

const CommandsTab = () => {
  const [commands, setCommands] = useState(null)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  const reload = () => {
    api
      .listSystemCommands()
      .then((res) => setCommands(res.commands))
      .catch((err) => setError(err.message))
  }

  useEffect(reload, [])

  const handleConfirm = async () => {
    setRunning(true)
    try {
      await api.runSystemCommand(pending.id)
      // A successful Shutdown/Restart call means the host is about to go
      // down (or is already rebooting) - there is no "after" state to
      // reload here, just tell the operator the call was accepted.
      setResult({ ok: true, label: pending.label })
    } catch (err) {
      setResult({ ok: false, label: pending.label, message: err.message })
    } finally {
      setRunning(false)
      setPending(null)
    }
  }

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!commands) return <CSpinner color="primary" />

  return (
    <div className="pt-2">
      {result && (
        <CAlert
          color={result.ok ? 'success' : 'danger'}
          dismissible
          onClose={() => setResult(null)}
        >
          {result.ok
            ? `${result.label} command sent.`
            : `${result.label} command failed: ${result.message}`}
        </CAlert>
      )}
      <CTable borderless>
        <CTableBody>
          {commands.map((command) => (
            <CommandRow key={command.id} command={command} onRun={setPending} />
          ))}
        </CTableBody>
      </CTable>

      <CModal visible={pending !== null} onClose={() => setPending(null)}>
        <CModalHeader>
          <CModalTitle>Confirm {pending?.label}</CModalTitle>
        </CModalHeader>
        <CModalBody>
          {pending?.description} This affects the host machine this stack runs on, not just this
          browser tab.
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            onClick={() => setPending(null)}
            disabled={running}
          >
            Cancel
          </CButton>
          <CButton color="danger" onClick={handleConfirm} disabled={running}>
            {running ? <CSpinner size="sm" /> : `Confirm ${pending?.label}`}
          </CButton>
        </CModalFooter>
      </CModal>
    </div>
  )
}

const PlaceholderTab = ({ label }) => (
  <div className="pt-2 text-body-secondary">{label} is not configured yet.</div>
)

// Registration for usePersistedState (AGENTS.md section 22) - remembers
// the last tab across visits; a saved key that no longer matches any TABS
// entry (a tab removed later) falls back to the first tab in the list
// rather than rendering nothing.
const PERSISTED_DEFAULTS = { activeTab: TABS[0].key }

const Service = () => {
  const [pageState, setPageState] = usePersistedState('nexusedge.servicePage', PERSISTED_DEFAULTS)
  const activeTab = TABS.some((t) => t.key === pageState.activeTab)
    ? pageState.activeTab
    : TABS[0].key
  const setActiveTab = (key) => setPageState({ activeTab: key })

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Service</strong>
      </CCardHeader>
      <CCardBody>
        <CTabs activeItemKey={activeTab} onChange={setActiveTab}>
          <CTabList variant="tabs" className="mb-3">
            {TABS.map((tab) => (
              <CTab key={tab.key} itemKey={tab.key}>
                {tab.label}
              </CTab>
            ))}
          </CTabList>
        </CTabs>
        {PLACEHOLDER_TABS.has(activeTab) && (
          <PlaceholderTab label={TABS.find((t) => t.key === activeTab).label} />
        )}
        {activeTab === 'database' && <DatabaseTab />}
        {activeTab === 'commands' && <CommandsTab />}
      </CCardBody>
    </CCard>
  )
}

export default Service
