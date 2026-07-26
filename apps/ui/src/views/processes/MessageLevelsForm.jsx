import React, { useEffect, useState } from 'react'
import { CAlert, CCol, CFormInput, CFormSelect, CRow, CSpinner } from '@coreui/react'
import { api } from '../../api/client'

const MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'constant', label: 'Constant' },
  { value: 'shortBeep', label: 'Short beep' },
  { value: 'longBeep', label: 'Long beep' },
]

// Period only means anything for a repeating beep - a constant tone has no
// "how often", and off has no sound at all.
const PERIOD_ENABLED_MODES = new Set(['shortBeep', 'longBeep'])

const rowKey = (row) => `${row.type}:${row.level}`

/**
 * Message Levels form (AGENTS.md section 22) - the fixed 8-row warning/
 * error x 1-4 matrix, seeded by migration (apps/api/migrations/
 * 1690000000018_create-message-levels-table.ts) - no add/remove here,
 * only each row's `mode`/`periodDeciseconds` is ever edited. Config-
 * storage only for now: nothing reads these values to actually play a
 * sound yet (still-deferred delivery mechanism, same as the `messenger`
 * process kind named in AGENTS.md section 22).
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
      await api.updateMessageLevel(row.type, row.level, row.mode, row.period_deciseconds)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  const handleModeChange = (row, mode) => {
    updateLocal(row.type, row.level, { mode })
    commit({ ...row, mode })
  }

  const handlePeriodChange = (row, value) => {
    const period = Math.max(0, Number(value) || 0)
    updateLocal(row.type, row.level, { period_deciseconds: period })
  }

  const handlePeriodBlur = (row) => commit(row)

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
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={row.mode}
              onChange={(e) => handleModeChange(row, e.target.value)}
            >
              {MODE_OPTIONS.map((opt) => (
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
              step={1}
              style={{ width: '7rem' }}
              disabled={!PERIOD_ENABLED_MODES.has(row.mode)}
              value={row.period_deciseconds}
              onChange={(e) => handlePeriodChange(row, e.target.value)}
              onBlur={() => handlePeriodBlur(row)}
            />
          </CCol>
          <CCol xs="auto" className="text-body-secondary small">
            tenths of a second
          </CCol>
        </CRow>
      ))}
    </div>
  )
}

export default MessageLevelsForm
