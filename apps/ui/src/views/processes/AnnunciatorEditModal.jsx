import React, { useState } from 'react'
import {
  CAlert,
  CButton,
  CCol,
  CFormSelect,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
} from '@coreui/react'
import { api } from '../../api/client'

/**
 * Alarm Annunciator (AGENTS_TO_DO.md, 2026-08-02) - binds each of the 8
 * fixed LED-pair slots to a Message Group. `redDeviceId`/`yellowDeviceId`
 * are never edited here (fixed at seed time, one physical LED pair per
 * slot) - only `messageGroupId` changes, via the same generic
 * `PATCH /processes/:id/config` every other process kind's settings use.
 */
const AnnunciatorEditModal = ({ visible, onClose, process, groups, onSaved }) => {
  const [slots, setSlots] = useState(process.config.slots ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const updateSlot = (index, messageGroupId) => {
    setSlots((prev) => prev.map((slot, i) => (i === index ? { ...slot, messageGroupId } : slot)))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await api.setProcessConfig(process.id, { slots })
      onSaved(result.config)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <CModal visible={visible} onClose={onClose}>
      <CModalHeader>
        <CModalTitle>Alarm Annunciator - slot bindings</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
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
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </CButton>
        <CButton color="primary" onClick={handleSave} disabled={saving}>
          Save
        </CButton>
      </CModalFooter>
    </CModal>
  )
}

export default AnnunciatorEditModal
