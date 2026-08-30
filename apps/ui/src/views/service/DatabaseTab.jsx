import React, { useEffect, useRef, useState } from 'react'
import {
  CAlert,
  CButton,
  CCol,
  CFormInput,
  CFormLabel,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { api } from '../../api/client'
import { formatBytes, formatSmartDateTime } from '../../utils/format'

// Service->Database (AGENTS_TO_DO.md, 2026-08-30) - donut segments read
// straight off CoreUI's own theme CSS variables rather than hardcoded hex,
// so the chart stays correct in both light and dark theme without its own
// separate dark-mode handling.
const CHART_COLORS = {
  config: 'var(--cui-primary)',
  logs: 'var(--cui-danger)',
  other: 'var(--cui-secondary)',
}

// Hand-rolled SVG donut (multiple stroke-dasharray arcs on one circle) -
// no new chart-library dependency for three static segments.
const DonutChart = ({ configBytes, logsBytes, otherBytes, totalBytes }) => {
  const radius = 60
  const circumference = 2 * Math.PI * radius
  const segments = [
    { key: 'config', value: configBytes, color: CHART_COLORS.config },
    { key: 'logs', value: logsBytes, color: CHART_COLORS.logs },
    { key: 'other', value: otherBytes, color: CHART_COLORS.other },
  ].filter((s) => s.value > 0)

  let cumulative = 0

  return (
    <svg
      viewBox="0 0 160 160"
      role="img"
      aria-label="Database volume breakdown"
      style={{ width: '100%', maxWidth: 220, height: 'auto' }}
    >
      <g transform="translate(80,80) rotate(-90)">
        {segments.length === 0 ? (
          <circle r={radius} fill="none" stroke="var(--cui-tertiary-bg)" strokeWidth="20" />
        ) : (
          segments.map((s) => {
            const dash = (s.value / totalBytes) * circumference
            const el = (
              <circle
                key={s.key}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth="20"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-cumulative}
              />
            )
            cumulative += dash
            return el
          })
        )}
      </g>
      <text
        x="80"
        y="76"
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="var(--cui-body-color)"
      >
        {formatBytes(totalBytes)}
      </text>
      <text x="80" y="94" textAnchor="middle" fontSize="10" fill="var(--cui-secondary-color)">
        total
      </text>
    </svg>
  )
}

const ChartLegend = ({ configBytes, logsBytes, otherBytes }) => (
  <div className="small mt-2">
    {[
      { label: 'Config', value: configBytes, color: CHART_COLORS.config },
      { label: 'Logs', value: logsBytes, color: CHART_COLORS.logs },
      { label: 'Other', value: otherBytes, color: CHART_COLORS.other },
    ].map((row) => (
      <div key={row.label} className="d-flex align-items-center justify-content-between">
        <span className="d-flex align-items-center gap-1">
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: row.color,
            }}
          />
          {row.label}
        </span>
        <span className="text-body-secondary">{formatBytes(row.value)}</span>
      </div>
    ))}
  </div>
)

const ACTION_ROWS = [
  {
    key: 'save',
    label: 'Save State',
    description:
      'Snapshot the current configuration (devices, nodes, processes, users, groups...) and add it to the list below.',
  },
  {
    key: 'download',
    label: 'Download State',
    description:
      'Download a snapshot of the current configuration as a file - not saved on the server.',
  },
  {
    key: 'upload',
    label: 'Upload State',
    description:
      'Upload a previously downloaded snapshot and apply it, replacing the current configuration.',
  },
  {
    key: 'clear-logs',
    label: 'Clear Logs',
    description: 'Permanently delete command/device/message logs. Configuration is not affected.',
  },
]

// Same-origin GET, so the browser attaches the session cookie automatically -
// the server's own Content-Disposition: attachment header does the actual
// "save as" work, this just triggers a real navigation/click rather than a
// fetch+blob round trip.
function triggerDownload(url) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const StampRow = ({ stamp, onApply, onDeleted, onError }) => {
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!deleteArmed) return undefined
    const timeout = setTimeout(() => setDeleteArmed(false), 3000)
    return () => clearTimeout(timeout)
  }, [deleteArmed])

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }
    setBusy(true)
    try {
      await api.deleteDatabaseStamp(stamp.filename)
      onDeleted()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
      setDeleteArmed(false)
    }
  }

  return (
    <CTableRow>
      <CTableDataCell>{stamp.name}</CTableDataCell>
      <CTableDataCell>{formatSmartDateTime(stamp.createdAt)}</CTableDataCell>
      <CTableDataCell>{formatBytes(stamp.sizeBytes)}</CTableDataCell>
      <CTableDataCell className="text-end">
        <div className="d-flex justify-content-end gap-1">
          <CButton
            size="sm"
            color="primary"
            variant="outline"
            disabled={busy}
            onClick={() => onApply(stamp)}
          >
            Apply
          </CButton>
          <CButton
            size="sm"
            color={deleteArmed ? 'danger' : 'secondary'}
            variant={deleteArmed ? undefined : 'outline'}
            disabled={busy}
            onClick={handleDelete}
          >
            {deleteArmed ? 'Confirm?' : 'Delete'}
          </CButton>
        </div>
      </CTableDataCell>
    </CTableRow>
  )
}

/**
 * Service->Database tab (AGENTS_TO_DO.md, 2026-08-30) - System Stamps
 * (config-table snapshots, saved as files - apps/api/src/systemStamps.ts)
 * plus Logs management. Layout per spec: donut chart (left) + action table
 * (right, height-matched via the row's own default align-items:stretch),
 * CRUD table of saved stamps below both. Apply lives ONLY on each stamp's
 * own row (user correction, 2026-08-30 - "Кнопки Apply тільки в таблиці
 * збережених станів") - the top action table is Save/Download/Upload/Clear
 * Logs only.
 */
const DatabaseTab = () => {
  const [stats, setStats] = useState(null)
  const [stamps, setStamps] = useState(null)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)

  const [pendingUploadFile, setPendingUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const [applyTarget, setApplyTarget] = useState(null)
  const [applying, setApplying] = useState(false)

  const [clearLogsConfirm, setClearLogsConfirm] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  const reloadStats = () => {
    api
      .getDatabaseStats()
      .then(setStats)
      .catch((err) => setError(err.message))
  }
  const reloadStamps = () => {
    api
      .listDatabaseStamps()
      .then((res) => setStamps(res.stamps))
      .catch((err) => setError(err.message))
  }

  useEffect(reloadStats, [])
  useEffect(reloadStamps, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.saveDatabaseStamp(saveName)
      setSaveModalOpen(false)
      setSaveName('')
      setMessage('State saved.')
      reloadStamps()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setPendingUploadFile(file)
  }

  const handleUpload = async () => {
    setUploading(true)
    setError(null)
    try {
      await api.uploadDatabaseStamp(pendingUploadFile)
      setPendingUploadFile(null)
      setMessage('State uploaded and applied.')
      reloadStats()
      reloadStamps()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    try {
      await api.applyDatabaseStamp(applyTarget.filename)
      setApplyTarget(null)
      setMessage(`Applied "${applyTarget.name}".`)
      reloadStats()
    } catch (err) {
      setError(err.message)
    } finally {
      setApplying(false)
    }
  }

  const handleClearLogs = async () => {
    setClearingLogs(true)
    setError(null)
    try {
      await api.clearDatabaseLogs()
      setClearLogsConfirm(false)
      setMessage('Logs cleared.')
      reloadStats()
    } catch (err) {
      setError(err.message)
    } finally {
      setClearingLogs(false)
    }
  }

  const runAction = (key) => {
    if (key === 'save') {
      setSaveName(new Date().toISOString())
      setSaveModalOpen(true)
    } else if (key === 'download') {
      triggerDownload('/api/service/database/download')
    } else if (key === 'upload') {
      fileInputRef.current?.click()
    } else if (key === 'clear-logs') {
      setClearLogsConfirm(true)
    }
  }

  return (
    <div className="pt-2">
      {error && (
        <CAlert color="danger" dismissible onClose={() => setError(null)}>
          {error}
        </CAlert>
      )}
      {message && (
        <CAlert color="success" dismissible onClose={() => setMessage(null)}>
          {message}
        </CAlert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={handleFileSelected}
        className="d-none"
      />

      <CRow className="g-3">
        <CCol md={4}>
          <div className="border rounded p-3 h-100 d-flex flex-column align-items-center justify-content-center">
            {!stats ? (
              <CSpinner size="sm" />
            ) : (
              <>
                <DonutChart {...stats} />
                <div className="w-100">
                  <ChartLegend {...stats} />
                </div>
              </>
            )}
          </div>
        </CCol>
        <CCol md={8}>
          <div>
            {ACTION_ROWS.map((row) => (
              <div key={row.key} className="row pb-2 align-items-center">
                <div className="col-3">
                  <CButton
                    className={'w-100'}
                    color={row.key === 'clear-logs' ? 'danger' : 'primary'}
                    variant="outline"
                    onClick={() => runAction(row.key)}
                  >
                    {row.label}
                  </CButton>
                </div>
                <div className="col-8 text-body-secondary small">{row.description}</div>
              </div>
            ))}
          </div>
        </CCol>
      </CRow>

      <h6 className="mt-4 mb-2">Saved states</h6>
      {!stamps ? (
        <CSpinner size="sm" />
      ) : stamps.length === 0 ? (
        <CAlert color="info">No saved states yet.</CAlert>
      ) : (
        <CTable small responsive>
          <CTableHead>
            <CTableRow>
              <CTableHeaderCell scope="col">Name</CTableHeaderCell>
              <CTableHeaderCell scope="col">Created</CTableHeaderCell>
              <CTableHeaderCell scope="col">Size</CTableHeaderCell>
              <CTableHeaderCell scope="col" className="text-end">
                Actions
              </CTableHeaderCell>
            </CTableRow>
          </CTableHead>
          <CTableBody>
            {stamps.map((stamp) => (
              <StampRow
                key={stamp.filename}
                stamp={stamp}
                onApply={setApplyTarget}
                onDeleted={reloadStamps}
                onError={setError}
              />
            ))}
          </CTableBody>
        </CTable>
      )}

      {/* Save State */}
      <CModal visible={saveModalOpen} onClose={() => setSaveModalOpen(false)}>
        <CModalHeader>
          <CModalTitle>Save State</CModalTitle>
        </CModalHeader>
        <CModalBody>
          <CFormLabel>Name</CFormLabel>
          <CFormInput
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            disabled={saving}
          />
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            onClick={() => setSaveModalOpen(false)}
            disabled={saving}
          >
            Cancel
          </CButton>
          <CButton color="primary" onClick={handleSave} disabled={saving}>
            {saving ? <CSpinner size="sm" /> : 'Save'}
          </CButton>
        </CModalFooter>
      </CModal>

      {/* Upload State confirm */}
      <CModal visible={pendingUploadFile !== null} onClose={() => setPendingUploadFile(null)}>
        <CModalHeader>
          <CModalTitle>Confirm Upload State</CModalTitle>
        </CModalHeader>
        <CModalBody>
          Applying <strong>{pendingUploadFile?.name}</strong> replaces the ENTIRE current
          configuration (devices, nodes, processes, users, groups...) with what's in this file. Logs
          are not affected. This cannot be undone unless you have a separate saved state.
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            onClick={() => setPendingUploadFile(null)}
            disabled={uploading}
          >
            Cancel
          </CButton>
          <CButton color="danger" onClick={handleUpload} disabled={uploading}>
            {uploading ? <CSpinner size="sm" /> : 'Upload and Apply'}
          </CButton>
        </CModalFooter>
      </CModal>

      {/* Apply State (per-row) confirm */}
      <CModal visible={applyTarget !== null} onClose={() => setApplyTarget(null)}>
        <CModalHeader>
          <CModalTitle>Confirm Apply State</CModalTitle>
        </CModalHeader>
        <CModalBody>
          Applying <strong>{applyTarget?.name}</strong> (
          {formatSmartDateTime(applyTarget?.createdAt)}) replaces the ENTIRE current configuration
          with this saved state. Logs are not affected. Consider using Save State first to keep a
          copy of what's about to be overwritten.
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            onClick={() => setApplyTarget(null)}
            disabled={applying}
          >
            Cancel
          </CButton>
          <CButton color="danger" onClick={handleApply} disabled={applying}>
            {applying ? <CSpinner size="sm" /> : 'Apply'}
          </CButton>
        </CModalFooter>
      </CModal>

      {/* Clear Logs confirm */}
      <CModal visible={clearLogsConfirm} onClose={() => setClearLogsConfirm(false)}>
        <CModalHeader>
          <CModalTitle>Confirm Clear Logs</CModalTitle>
        </CModalHeader>
        <CModalBody>
          This permanently deletes every command/device/message log entry. Configuration (devices,
          nodes, processes, users...) is not affected. This cannot be undone.
        </CModalBody>
        <CModalFooter>
          <CButton
            color="secondary"
            variant="outline"
            onClick={() => setClearLogsConfirm(false)}
            disabled={clearingLogs}
          >
            Cancel
          </CButton>
          <CButton color="danger" onClick={handleClearLogs} disabled={clearingLogs}>
            {clearingLogs ? <CSpinner size="sm" /> : 'Clear Logs'}
          </CButton>
        </CModalFooter>
      </CModal>
    </div>
  )
}

export default DatabaseTab
