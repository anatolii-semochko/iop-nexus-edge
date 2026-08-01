import React, { useEffect, useState } from 'react'
import { CAlert, CCol, CFormInput, CFormSelect, CRow, CSpinner } from '@coreui/react'
import { api } from '../../api/client'
import {
  decodeSelectorValue,
  encodeSelectorValue,
  formatMessageLevel,
  SELECTOR_OPTIONS,
} from '../../utils/messageLevel'

// Repeat only means anything for a repeating beep - a constant tone has no
// "how often", and off has no sound at all.
const REPEAT_ENABLED_MODES = new Set(['shortBeep', 'longBeep'])

const rowKey = (row) => `${row.type}:${row.level}`

/**
 * Message Levels form (AGENTS.md section 22, beep-count/repeat-seconds
 * redesign AGENTS_TO_DO.md 2026-08-01) - the fixed 8-row warning/error x
 * 1-4 matrix, seeded by migration (apps/api/migrations/
 * 1690000000018_create-message-levels-table.ts) - no add/remove here, only
 * each row's `mode`/`beepCount`/`repeatSeconds` is ever edited. Read by
 * apps/orchestrator's active-buzzer process (alarmPolicy.ts) every tick to
 * decide what a sound-output device should be doing right now - the
 * per-style beep-length/pause timing itself lives in
 * MessageSignalTimingForm.jsx (to the right of this one), one shared
 * profile for the whole system rather than per level.
 */
const MessageLevelsForm = () => {
  const [levels, setLevels] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .listMessageLevels()
      .then(setLevels)
      .catch((err) => setError(err.message))
  }, [])

  const updateLocal = (type, level, patch) => {
    setLevels((prev) =>
      prev.map((row) => (row.type === type && row.level === level ? { ...row, ...patch } : row)),
    )
  }

  const commit = async (row) => {
    try {
      await api.updateMessageLevel(
        row.type,
        row.level,
        row.mode,
        row.beep_count,
        row.repeat_seconds,
      )
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSelectorChange = (row, value) => {
    const { mode, beepCount } = decodeSelectorValue(value)
    const patch = { mode, beep_count: beepCount }
    updateLocal(row.type, row.level, patch)
    commit({ ...row, ...patch })
  }

  const handleRepeatChange = (row, value) => {
    const repeatSeconds = Math.max(0, Number(value) || 0)
    updateLocal(row.type, row.level, { repeat_seconds: repeatSeconds })
  }

  const handleRepeatBlur = (row) => commit(row)

  if (error && !levels) return <CAlert color="danger">{error}</CAlert>
  if (!levels) return <CSpinner size="sm" />

  return (
    <div>
      {error && <CAlert color="danger">{error}</CAlert>}
      {levels.map((row) => (
        <CRow key={rowKey(row)} className="align-items-center g-2 mb-2">
          <CCol xs="auto" style={{ width: '7rem' }}>
            <span className="text-capitalize">{row.type}</span> {row.level}
          </CCol>
          <CCol xs="auto" style={{ width: '11rem' }}>
            <CFormSelect
              size="sm"
              value={encodeSelectorValue(row.mode, row.beep_count)}
              onChange={(e) => handleSelectorChange(row, e.target.value)}
            >
              {SELECTOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormInput
              size="sm"
              type="number"
              min={0}
              step={0.01}
              style={{ width: '6.5rem' }}
              disabled={!REPEAT_ENABLED_MODES.has(row.mode)}
              value={row.repeat_seconds}
              onChange={(e) => handleRepeatChange(row, e.target.value)}
              onBlur={() => handleRepeatBlur(row)}
            />
          </CCol>
          <CCol xs="auto" className="text-body-secondary small" style={{ width: '5rem' }}>
            seconds
          </CCol>
          <CCol className="text-body-secondary small">
            {formatMessageLevel({
              type: row.type,
              mode: row.mode,
              beepCount: row.beep_count,
              repeatSeconds: row.repeat_seconds,
            })}
          </CCol>
        </CRow>
      ))}
    </div>
  )
}

export default MessageLevelsForm
