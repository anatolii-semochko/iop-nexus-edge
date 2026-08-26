import React, { useEffect, useState } from 'react'
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
import { formatMessageLevel } from '../../utils/messageLevel'

const LEVEL_OPTIONS = [1, 2, 3, 4]

// "Level 2 - Warning 3 short beeps (repeatable)" instead of a bare "Level
// 2" - same helper HeartbeatEditModal.jsx uses, shows what picking this
// level will actually sound like, sourced from Processes -> Settings ->
// Message Levels. Falls back to the bare label while messageLevels hasn't
// loaded yet, or if a row is missing.
const levelOptionLabel = (type, level, messageLevels) => {
  const row = messageLevels?.find((r) => r.type === type && r.level === level)
  if (!row) return `Level ${level}`
  return `Level ${level} - ${formatMessageLevel({
    type,
    mode: row.mode,
    beepCount: row.beep_count,
    repeatSeconds: row.repeat_seconds,
  })}`
}

// One threshold row (warning or error) - same shape as
// HeartbeatEditModal's ThresholdRow, but counting *periods of this
// device's own periodSeconds* (AGENTS.md's Data Logger section),
// not raw system ticks.
const ThresholdRow = ({ type, label, value, onChange, messageLevels }) => {
  // `!= null` (not `!== null`) - belt and braces against a sparse
  // `dataLoggerControl` object (a device whose column was never written
  // comes back missing this key entirely, `undefined`, not explicit
  // `null` - apps/api/src/dataLoggerControl.ts's own normalizer is the
  // real fix, this is defense-in-depth so a future gap in that
  // normalization degrades to "off" instead of crashing on
  // `value.numberSkippedPeriods`, confirmed live, AGENTS_TO_DO.md
  // 2026-08-26).
  const enabled = value != null
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
          value={enabled ? value.numberSkippedPeriods : ''}
          onChange={(e) =>
            onChange({ ...value, numberSkippedPeriods: Math.max(1, Number(e.target.value) || 1) })
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
                    numberSkippedPeriods: value?.numberSkippedPeriods ?? 1,
                    level: Number(e.target.value),
                  },
            )
          }
        >
          <option value="">Off (not monitored)</option>
          {LEVEL_OPTIONS.map((level) => (
            <option key={level} value={level}>
              {levelOptionLabel(type, level, messageLevels)}
            </option>
          ))}
        </CFormSelect>
      </CCol>
    </CRow>
  )
}

/**
 * Edit popup for one device's logging period + warning/error thresholds
 * (AGENTS.md's Data Logger section). Clearing the period entirely also
 * clears `writeEnabled` server-side (routes/dataLoggerControls.ts) - the
 * row's own write/ignore switch becomes disabled+off the moment this is
 * saved with an empty period, per the user's own spec.
 */
const DataLoggerEditModal = ({ entry, onClose, onSaved }) => {
  const [periodSeconds, setPeriodSeconds] = useState(entry.dataLoggerControl.periodSeconds)
  const [warning, setWarning] = useState(entry.dataLoggerControl.warning)
  const [error_, setError_] = useState(entry.dataLoggerControl.error)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [messageLevels, setMessageLevels] = useState(null)

  useEffect(() => {
    api
      .listMessageLevels()
      .then(setMessageLevels)
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateDataLoggerControl(entry.id, { periodSeconds, warning, error: error_ })
      onSaved()
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }

  return (
    <CModal visible onClose={onClose}>
      <CModalHeader>
        <CModalTitle>Data logging - {entry.name}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {saveError && <CAlert color="danger">{saveError}</CAlert>}
        <CRow className="align-items-center g-2 mb-3">
          <CCol xs="3">
            <div className="text-body-secondary small">Period (s)</div>
          </CCol>
          <CCol xs="9">
            <CFormInput
              size="sm"
              type="number"
              min={0}
              step={0.01}
              placeholder="60.00"
              value={periodSeconds ?? ''}
              onChange={(e) =>
                setPeriodSeconds(e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </CCol>
        </CRow>
        <ThresholdRow
          type="warning"
          label="Warning"
          value={warning}
          onChange={setWarning}
          messageLevels={messageLevels}
        />
        <ThresholdRow
          type="error"
          label="Error"
          value={error_}
          onChange={setError_}
          messageLevels={messageLevels}
        />
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

export default DataLoggerEditModal
