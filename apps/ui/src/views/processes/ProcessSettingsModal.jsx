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
} from '@coreui/react'
import { api } from '../../api/client'
import WeatherZonesSection from './WeatherZonesSection'

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

// Per-kind extra section, rendered below the standard Tab Groups/Message
// Casting Groups pair (AGENTS_TO_DO.md, 2026-08-02 - "один основний
// попап з конфігом... загальні стандартні опції, а після того блок
// унікальних для процесу опцій"). A plain kind->component map, same
// dispatch idiom ProcessesTable.jsx's own KIND_PANELS already uses. Two
// entries as of 2026-08-23 (weather-control's own WeatherZonesSection
// joined this one) - EXTRA_CONFIG_FIELD below is what lets handleSave
// stay generic across however many of these end up existing.
// Owns its own slots state, initialized straight from `process.config.
// slots` - safe as a plain useState initializer (no effect needed)
// because this component only ever renders inside the `visible &&
// process &&` block below, so it mounts fresh every time the modal
// opens, same as GroupCheckboxSection above. Writes its latest value
// into `extraConfigRef` from the CFormSelect's own onChange handler (a
// ref write during a real event is always safe - unlike during render or
// inside an effect body, both of which this codebase's stricter React
// Compiler-era lint rules reject) so the parent's Save handler can read
// the latest edited value on demand, without lifting this into parent
// state (which would need an effect to reset on reopen, since the
// parent itself never unmounts - see ProcessSettingsModal's own
// `extraConfigRef` comment for why that's the one thing to avoid here).
const AnnunciatorSlotsSection = ({ process, groups, extraConfigRef }) => {
  const [slots, setSlots] = useState(process.config.slots ?? [])

  const updateSlot = (index, messageGroupId) => {
    const next = slots.map((s, i) => (i === index ? { ...s, messageGroupId } : s))
    setSlots(next)
    extraConfigRef.current = next
  }

  return (
    <div className="mb-3">
      <div className="text-body-secondary small mb-2">Alarm Annunciator - slot bindings</div>
      {slots.map((slot, index) => (
        <CRow key={index} className="align-items-center g-2 mb-2">
          <CCol xs="3">
            <div className="text-body-secondary small">Slot {index + 1}</div>
          </CCol>
          <CCol>
            <CFormSelect
              size="sm"
              value={slot.messageGroupId ?? ''}
              onChange={(e) =>
                updateSlot(index, e.target.value === '' ? null : Number(e.target.value))
              }
            >
              <option value="">Not bound</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </CFormSelect>
          </CCol>
        </CRow>
      ))}
    </div>
  )
}

const EXTRA_SETTINGS_SECTIONS = {
  'alarm-annunciator': AnnunciatorSlotsSection,
  // Node Weather Control.txt / AGENTS_TO_DO.md 2026-08-23 - zone
  // boundaries/colors for the derived light-level classification, same
  // "Config процесу" placement the spec asked for.
  'weather-control': WeatherZonesSection,
}

// Which process.config field each EXTRA_SETTINGS_SECTIONS entry stages
// its edits into, read back by handleSave below - a plain kind->field
// map since AnnunciatorSlotsSection/WeatherZonesSection each own exactly
// one config field.
const EXTRA_CONFIG_FIELD = {
  'alarm-annunciator': 'slots',
  'weather-control': 'zones',
}

/**
 * Per-process Settings popup (AGENTS.md section 22) - opened from the
 * first action button on a process's row. Standard sections first (Tab
 * Groups, Message Casting Groups - which notification routing groups
 * this process CASTS its WEM into, AGENTS_TO_DO.md 2026-08-02 rename
 * disambiguating from the not-yet-built inverse "Message Receiving
 * Groups" some future process kinds will have), then one optional
 * kind-specific block below (`EXTRA_SETTINGS_SECTIONS`) - single popup
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

  const ExtraSection = process && EXTRA_SETTINGS_SECTIONS[process.kind]
  const extraConfigField = process && EXTRA_CONFIG_FIELD[process.kind]

  const handleClose = () => {
    extraConfigRef.current = null
    onClose()
  }

  const handleSave = async () => {
    setBusy(true)
    setError(null)
    try {
      const writes = [
        api.setProcessTabGroups(process.id, [...selectedTabGroupIds]),
        api.setProcessMessageGroups(process.id, [...selectedMessageGroupIds]),
      ]
      if (ExtraSection && extraConfigField) {
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

  return (
    <CModal visible={visible} onClose={handleClose}>
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
              title="Message Casting Groups"
              items={messageGroups}
              fetchSelected={() => api.getProcessMessageGroups(process.id)}
              selectedIds={selectedMessageGroupIds}
              onChange={setSelectedMessageGroupIds}
              busy={busy}
            />
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
