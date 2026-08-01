import React, { useEffect, useState } from 'react'
import { CAlert, CCol, CFormInput, CRow, CSpinner } from '@coreui/react'
import { api } from '../../api/client'

// { local state key (snake_case, matches GET), PATCH body key (camelCase), label }
const FIELDS = [
  { key: 'short_beep_seconds', patchKey: 'shortBeepSeconds', label: 'Short beep length' },
  {
    key: 'short_beep_pause_seconds',
    patchKey: 'shortBeepPauseSeconds',
    label: 'Pause between short beeps',
  },
  { key: 'long_beep_seconds', patchKey: 'longBeepSeconds', label: 'Long beep length' },
  {
    key: 'long_beep_pause_seconds',
    patchKey: 'longBeepPauseSeconds',
    label: 'Pause between long beeps',
  },
]

/**
 * Message Signal Timing form (AGENTS_TO_DO.md, 2026-08-01) - the one
 * global beep-length/pause profile shared by every Message Levels row's
 * shortBeep/longBeep mode (apps/api's message_signal_timing singleton
 * table), replacing what used to be hardcoded constants in
 * apps/orchestrator/src/processes/activeBuzzer.ts
 * (SHORT_BEEP_ON_DECISECONDS/LONG_BEEP_ON_DECISECONDS). One profile for
 * the whole system, not per level - confirmed with the user.
 */
const MessageSignalTimingForm = () => {
  const [timing, setTiming] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .getMessageSignalTiming()
      .then(setTiming)
      .catch((err) => setError(err.message))
  }, [])

  const handleChange = (key, value) => {
    setTiming((prev) => ({ ...prev, [key]: Math.max(0, Number(value) || 0) }))
  }

  const handleBlur = async (field) => {
    try {
      await api.updateMessageSignalTiming({ [field.patchKey]: timing[field.key] })
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  if (error && !timing) return <CAlert color="danger">{error}</CAlert>
  if (!timing) return <CSpinner size="sm" />

  return (
    <div>
      {error && <CAlert color="danger">{error}</CAlert>}
      {FIELDS.map((field) => (
        <CRow key={field.key} className="align-items-center g-2 mb-2">
          <CCol>
            <div className="text-body-secondary small">{field.label}</div>
          </CCol>
          <CCol xs="auto">
            <CFormInput
              size="sm"
              type="number"
              min={0}
              step={0.01}
              style={{ width: '6.5rem' }}
              value={timing[field.key]}
              onChange={(e) => handleChange(field.key, e.target.value)}
              onBlur={() => handleBlur(field)}
            />
          </CCol>
          <CCol xs="auto" className="text-body-secondary small" style={{ width: '4rem' }}>
            seconds
          </CCol>
        </CRow>
      ))}
    </div>
  )
}

export default MessageSignalTimingForm
