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
  CTabs,
} from '@coreui/react'
import { api } from '../../api/client'

// Service page (AGENTS_TO_DO.md, 2026-08-30) - admin-only (server-side
// requireAdmin on every /service/* route, same pattern as UsersList.jsx's
// own /users routes - this page has no extra client-side guard beyond
// that, it trusts the 403). Tabs will grow (user's own "буде
// розширюватися") - Config/Database are placeholders for now, Commands is
// the first real one.
const TABS = [
  { key: 'config', label: 'Config' },
  { key: 'database', label: 'Database' },
  { key: 'commands', label: 'Commands' },
]

const PLACEHOLDER_TABS = new Set(['config', 'database'])

const CommandRow = ({ command, onRun }) => (
  <div className="d-flex align-items-center justify-content-between py-2 border-bottom">
    <div>
      <CButton
        color={command.enabled ? 'danger' : 'secondary'}
        variant="outline"
        disabled={!command.enabled}
        onClick={() => onRun(command)}
      >
        {command.label}
      </CButton>
      {!command.enabled && (
        <CBadge color="secondary" className="ms-2">
          disabled
        </CBadge>
      )}
    </div>
    <div className="text-body-secondary small text-end ms-3">{command.description}</div>
  </div>
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
      {commands.map((command) => (
        <CommandRow key={command.id} command={command} onRun={setPending} />
      ))}

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

const Service = () => {
  const [activeTab, setActiveTab] = useState('commands')

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
        {activeTab === 'commands' && <CommandsTab />}
      </CCardBody>
    </CCard>
  )
}

export default Service
