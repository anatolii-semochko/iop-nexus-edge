import React, { useState } from 'react'
import { CCol, CFormSelect, CRow } from '@coreui/react'

// Per-kind extra section, rendered below the standard Tab Groups/Message
// Casting Groups pair in ProcessSettingsModal.jsx (AGENTS_TO_DO.md,
// 2026-08-02 - "один основний попап з конфігом... загальні стандартні
// опції, а після того блок унікальних для процесу опцій"). Registered via
// processTypeRegistry.js (builtinProcessTypes.js), same mechanism a
// private plugin's own settings section would use.
//
// Owns its own slots state, initialized straight from `process.config.
// slots` - safe as a plain useState initializer (no effect needed)
// because this component only ever renders inside ProcessSettingsModal's
// own `visible && process &&` block, so it mounts fresh every time the
// modal opens, same as GroupCheckboxSection there. Writes its latest
// value into `extraConfigRef` from the CFormSelect's own onChange handler
// (a ref write during a real event is always safe - unlike during render
// or inside an effect body, both of which this codebase's stricter React
// Compiler-era lint rules reject) so the parent's Save handler can read
// the latest edited value on demand, without lifting this into parent
// state (which would need an effect to reset on reopen, since the parent
// itself never unmounts - see ProcessSettingsModal's own `extraConfigRef`
// comment for why that's the one thing to avoid here).
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

export default AnnunciatorSlotsSection
