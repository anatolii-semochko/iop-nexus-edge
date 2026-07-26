import React, { useState } from 'react'
import {
  CAlert,
  CButton,
  CCol,
  CFormInput,
  CFormSelect,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
} from '@coreui/react'
import { api } from '../../api/client'

const LEVEL_OPTIONS = [1, 2, 3, 4]

// One threshold row (warning or error) - a level select that also carries
// "off" (null - not monitored at this severity at all, AGENTS.md's
// Heartbeating Control section) plus a skipped-ticks number input, only
// enabled once a level is actually picked.
const ThresholdRow = ({ label, value, onChange }) => {
  const enabled = value !== null
  return (
    <CRow className="align-items-center g-2 mb-2">
      <CCol xs="3">
        <div className="text-body-secondary small">{label}</div>
      </CCol>
      <CCol xs="4">
        <CFormInput
          size="sm"
          type="number"
          min={1}
          disabled={!enabled}
          value={enabled ? value.numberSkippedTicks : ''}
          onChange={(e) =>
            onChange({ ...value, numberSkippedTicks: Math.max(1, Number(e.target.value) || 1) })
          }
        />
      </CCol>
      <CCol xs="5">
        <CFormSelect
          size="sm"
          value={enabled ? value.level : ''}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? null
                : {
                    numberSkippedTicks: value?.numberSkippedTicks ?? 3,
                    level: Number(e.target.value),
                  },
            )
          }
        >
          <option value="">Off (not monitored)</option>
          {LEVEL_OPTIONS.map((level) => (
            <option key={level} value={level}>
              Level {level}
            </option>
          ))}
        </CFormSelect>
      </CCol>
    </CRow>
  )
}

/**
 * Edit popup for one heartbeat-monitored entity's warning/error thresholds
 * (AGENTS.md's Heartbeating Control section) - `stoppable` is deliberately
 * not editable here at all (system-set, per the user's own spec), only
 * `warning`/`error` are ever sent to the PATCH.
 */
const HeartbeatEditModal = ({ entry, onClose, onSaved }) => {
  const [warning, setWarning] = useState(entry.heartbeatControl.warning)
  const [error_, setError_] = useState(entry.heartbeatControl.error)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateHeartbeatControl(entry.type, entry.id, { warning, error: error_ })
      onSaved()
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <CModal visible onClose={onClose}>
      <CModalHeader>
        <CModalTitle>Heartbeat thresholds - {entry.name}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {saveError && <CAlert color="danger">{saveError}</CAlert>}
        <ThresholdRow label="Warning" value={warning} onChange={setWarning} />
        <ThresholdRow label="Error" value={error_} onChange={setError_} />
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

export default HeartbeatEditModal
