import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CButton,
  CFormCheck,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react'
import { api } from '../../api/client'

// One checkbox section - fetches this process's current membership in
// `items` (Tab Groups or Message Groups, whichever `entity` names) when
// the modal opens, exposes the locally-edited selection back to the
// parent via `onChange` so a single Save can persist both sections at
// once (AGENTS.md section 22 - Tab Groups and Message Groups are
// independent entities, but both edited from the same popup).
const GroupCheckboxSection = ({ title, items, fetchSelected, selectedIds, onChange, busy }) => {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchSelected()
      .then((ids) => {
        if (!cancelled) onChange(new Set(ids))
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    // This component mounts fresh each time the modal opens (see the
    // `visible &&` guard around it in ProcessSettingsModal) and unmounts
    // on close, so `loading`'s own `useState(true)` initial value already
    // covers "starts loading again next open" - no separate reset needed,
    // and this only ever needs to run once per mount, not on every
    // `fetchSelected` identity change: `fetchSelected` is a fresh inline
    // closure every ProcessSettingsModal render (it closes over `process`),
    // so depending on it here would re-run this fetch after every toggle
    // (toggle -> onChange -> parent re-render -> new fetchSelected
    // reference -> effect re-fires -> overwrites the just-toggled
    // selection with the server's still-unchanged data - reproduced
    // live, a checkbox visually never stuck checked).
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onChange(next)
  }

  return (
    <div className="mb-3">
      <div className="text-body-secondary small mb-2">{title}</div>
      {error && <CAlert color="danger">{error}</CAlert>}
      {loading ? (
        <CSpinner size="sm" />
      ) : items.length === 0 ? (
        <div className="text-body-secondary">Nothing here yet - add some in Settings.</div>
      ) : (
        items.map((item) => (
          <CFormCheck
            key={item.id}
            id={`${title}-${item.id}`}
            label={item.name}
            checked={selectedIds.has(item.id)}
            disabled={busy}
            onChange={() => toggle(item.id)}
          />
        ))
      )}
    </div>
  )
}

/**
 * Per-process Settings popup (AGENTS.md section 22) - opened from the
 * first action button on a process's row. Two independent checkbox
 * sections: Tab Groups (which of the operator's curated page tabs this
 * process shows up in) and Message Groups (which notification routing
 * groups this process's WEM goes to) - structurally identical, but
 * genuinely separate entities (a process can be in either, both, or
 * neither, independently), each with its own Save-time PUT.
 *
 * `tabGroups`/`messageGroups` (already loaded/ordered at the page level)
 * are passed in rather than fetched here - the same lists every row's
 * popup would otherwise re-fetch identically. Only this process's own
 * current membership in each is fetched on open.
 */
const ProcessSettingsModal = ({ visible, onClose, process, tabGroups, messageGroups, onSaved }) => {
  const [selectedTabGroupIds, setSelectedTabGroupIds] = useState(new Set())
  const [selectedMessageGroupIds, setSelectedMessageGroupIds] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      await Promise.all([
        api.setProcessTabGroups(process.id, [...selectedTabGroupIds]),
        api.setProcessMessageGroups(process.id, [...selectedMessageGroupIds]),
      ])
      onSaved?.()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CModal visible={visible} onClose={onClose}>
      <CModalHeader>
        <CModalTitle>{process?.name} settings</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {/* Sections mount only while the modal is actually open - not
            merely `visible`-styled by CoreUI but conditionally rendered
            here too, so every row's hidden popup doesn't eagerly fetch
            membership for a process nobody has opened Settings for yet.
            Unmounting on close is also what gives a reopen a fresh fetch,
            no separate loading-reset plumbing needed. */}
        {visible && process && (
          <>
            <GroupCheckboxSection
              title="Tab Groups"
              items={tabGroups}
              fetchSelected={() => api.getProcessTabGroups(process.id)}
              selectedIds={selectedTabGroupIds}
              onChange={setSelectedTabGroupIds}
              busy={busy}
            />
            <GroupCheckboxSection
              title="Message Groups"
              items={messageGroups}
              fetchSelected={() => api.getProcessMessageGroups(process.id)}
              selectedIds={selectedMessageGroupIds}
              onChange={setSelectedMessageGroupIds}
              busy={busy}
            />
          </>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </CButton>
        <CButton color="success" onClick={handleSave} disabled={busy}>
          {busy ? <CSpinner size="sm" /> : 'Save'}
        </CButton>
      </CModalFooter>
    </CModal>
  )
}

export default ProcessSettingsModal
