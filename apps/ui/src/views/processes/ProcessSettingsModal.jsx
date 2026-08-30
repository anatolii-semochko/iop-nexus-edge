import React, { useEffect, useRef, useState } from 'react'
import {
  CAlert,
  CButton,
  CCol,
  CFormCheck,
  CFormSelect,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
  CTab,
  CTabList,
  CTabs,
} from '@coreui/react'
import { api } from '../../api/client'
import { processSettingsSections, processSettingsConfigFields } from '../../processTypeRegistry'

// One checkbox section - fetches this process's current membership in
// `items` (Tab Groups or Message Casting Groups, whichever `entity`
// names) when the modal opens, exposes the locally-edited selection
// back to the parent via `onChange` so a single Save can persist both
// sections at once (AGENTS.md section 22 - Tab Groups and Message
// Casting Groups are independent entities, but both edited from the
// same popup).
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
 * first action button on a process's row. Standard sections first (Tab
 * Groups, Message Casting Groups - which notification routing groups
 * this process CASTS its WEM into, AGENTS_TO_DO.md 2026-08-02 rename
 * disambiguating from the not-yet-built inverse "Message Receiving
 * Groups" some future process kinds will have), then one optional
 * kind-specific block below (`processSettingsSections`, processTypeRegistry.js) - single popup
 * per process, not a separate kind-specific modal (AGENTS_TO_DO.md,
 * 2026-08-02 - Alarm Annunciator's own slot-binding UI used to be a
 * second modal opened from the expanded panel; consolidated here).
 * The underlying Message Groups entity/table/route/field names
 * (`message_groups`, `/message-groups`, `messageGroupId`) are
 * deliberately unchanged - this is a display-label rename only, scoped
 * to this popup (the one place users actually see the ambiguity).
 *
 * `tabGroups`/`messageGroups` (already loaded/ordered at the page level)
 * are passed in rather than fetched here - the same lists every row's
 * popup would otherwise re-fetch identically. Only this process's own
 * current membership in each is fetched on open; the extra section's own
 * data (`process.config.slots`) is already on `process`, no separate
 * fetch needed.
 *
 * Settings tabs (opt-in, AGENTS_TO_DO.md 2026-08-25 "cosmetic
 * improvements") - a kind whose own ExtraSection has grown too large for
 * one flat scroll (Aquarium Light Control's first real case) can declare
 * `ExtraSection.settingsTabs = ['Configuration', 'Channels']` (a plain
 * static array on the component, no new registry needed) to split the
 * popup into a "System" tab (this component's own Tabs/Message Casting
 * Groups sections, unchanged) plus one tab per declared label, each
 * rendered by the SAME ExtraSection instance (passed the active tab's
 * lowercased label as `activeSettingsTab`, so it can pick which of its
 * own pieces to show) - same "conditionally rendered, not CTabContent/
 * CTabPanel" idiom `AquariumLightControlPanel.jsx`'s own tabs already
 * use, so an inactive tab's own fetch/render doesn't run. A kind with no
 * `settingsTabs` (every other kind today) renders exactly as before -
 * no CTabs wrapper at all.
 */
const ProcessSettingsModal = ({ visible, onClose, process, tabGroups, messageGroups, onSaved }) => {
  const [selectedTabGroupIds, setSelectedTabGroupIds] = useState(new Set())
  const [selectedMessageGroupIds, setSelectedMessageGroupIds] = useState(new Set())
  // Not React state - the active ExtraSection (mounts fresh each open,
  // see AnnunciatorSlotsSection's own comment) writes an edited value
  // here from its own onChange handler; `null` means "untouched this
  // session", so handleSave falls back to the process's own current
  // config (a no-op write, not data loss). Reset on close so a
  // cancelled edit for one process can never leak into a later save for
  // another.
  const extraConfigRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState('system')

  const ExtraSection = process && processSettingsSections[process.kind]
  const extraConfigField = process && processSettingsConfigFields[process.kind]
  const settingsTabs = ExtraSection?.settingsTabs
  // Tab Groups are a Processes-page navigation concept (dynamic tabs on
  // that page's own Dashboard/All/Controllable/etc strip) - meaningless
  // for a `simulation`-type process, which only ever appears on the
  // Simulator page's own flat, tab-less list (AGENTS_TO_DO.md, 2026-08-29:
  // "Tabs видали, Message Casting Groups залиш"). Message Casting Groups
  // stays for every process type - it's how a simulation process's own
  // error casting (setCritical/syncMessages) actually gets routed.
  const isSimulation = process?.type === 'simulation'

  const handleClose = () => {
    extraConfigRef.current = null
    setActiveSettingsTab('system')
    onClose()
  }

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      const writes = [api.setProcessMessageGroups(process.id, [...selectedMessageGroupIds])]
      // No tab-group write for a simulation process - the section above is
      // never shown to edit it, so `selectedTabGroupIds` would otherwise
      // always be the empty Set it starts as, silently wiping out any
      // existing membership on every save.
      if (!isSimulation) {
        writes.push(api.setProcessTabGroups(process.id, [...selectedTabGroupIds]))
      }
      if (ExtraSection && extraConfigField === '*') {
        writes.push(api.setProcessConfig(process.id, extraConfigRef.current ?? {}))
      } else if (ExtraSection && extraConfigField) {
        writes.push(
          api.setProcessConfig(process.id, {
            [extraConfigField]: extraConfigRef.current ?? process.config[extraConfigField],
          }),
        )
      }
      await Promise.all(writes)
      onSaved?.()
      handleClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const groupSections = (
    <>
      {!isSimulation && (
        <GroupCheckboxSection
          title="Tabs"
          items={tabGroups}
          fetchSelected={() => api.getProcessTabGroups(process.id)}
          selectedIds={selectedTabGroupIds}
          onChange={setSelectedTabGroupIds}
          busy={busy}
        />
      )}
      <GroupCheckboxSection
        title="Message Casting Groups"
        items={messageGroups}
        fetchSelected={() => api.getProcessMessageGroups(process.id)}
        selectedIds={selectedMessageGroupIds}
        onChange={setSelectedMessageGroupIds}
        busy={busy}
      />
    </>
  )

  return (
    <CModal visible={visible} onClose={handleClose} size="lg">
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
        {visible && process && settingsTabs && (
          <>
            <CTabs activeItemKey={activeSettingsTab} onChange={setActiveSettingsTab}>
              <CTabList variant="tabs" className="mb-3">
                <CTab itemKey="system">System</CTab>
                {settingsTabs.map((label) => (
                  <CTab key={label} itemKey={label.toLowerCase()}>
                    {label}
                  </CTab>
                ))}
              </CTabList>
            </CTabs>
            {activeSettingsTab === 'system' && groupSections}
            {/* ExtraSection stays mounted across a System <-> Configuration/
                Channels round-trip (CSS-hidden, not unmounted) so its own
                internal `useState` (staged edits) survives switching tabs -
                unmounting and remounting would re-run that initializer
                against the process's still-unsaved-on-the-server config,
                silently discarding whatever the user had just typed. */}
            <div style={{ display: activeSettingsTab === 'system' ? 'none' : undefined }}>
              <ExtraSection
                process={process}
                groups={messageGroups}
                extraConfigRef={extraConfigRef}
                activeSettingsTab={activeSettingsTab}
              />
            </div>
          </>
        )}
        {visible && process && !settingsTabs && isSimulation && (
          // Side by side (AGENTS_TO_DO.md, 2026-08-30) - Message Casting
          // Groups left, the kind's own config form right. Scoped to
          // `isSimulation` specifically, not every non-tabbed ExtraSection
          // kind (e.g. WeatherZonesSection/AnnunciatorSlotsSection) - those
          // still stack top-to-bottom as before, unaffected.
          <CRow>
            <CCol md={6}>{groupSections}</CCol>
            <CCol md={6}>
              {ExtraSection && (
                <ExtraSection
                  process={process}
                  groups={messageGroups}
                  extraConfigRef={extraConfigRef}
                />
              )}
            </CCol>
          </CRow>
        )}
        {visible && process && !settingsTabs && !isSimulation && (
          <>
            {groupSections}
            {ExtraSection && (
              <ExtraSection
                process={process}
                groups={messageGroups}
                extraConfigRef={extraConfigRef}
              />
            )}
          </>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={handleClose} disabled={busy}>
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
