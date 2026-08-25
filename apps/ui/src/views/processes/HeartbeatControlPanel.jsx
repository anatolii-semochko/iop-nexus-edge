import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CCol,
  CFormSelect,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilLibrary, cilReload, cilSettings } from '@coreui/icons'
import { api } from '../../api/client'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import Switch from '../../components/Switch'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'
import HeartbeatEditModal from './HeartbeatEditModal'

const TYPE_LABEL = { process: 'Process', device: 'Device', node: 'Node' }

const formatThreshold = (threshold) =>
  threshold ? `${threshold.numberSkippedTicks} ticks → level ${threshold.level}` : 'off'

// Same background-color rule as Devices/Nodes/Processes (section 56):
// error -> danger, warning -> warning - no "simulation" tier here, this
// panel spans three entity types and only staleness is a shared concept
// across all of them. Factored so the row's own highlight and the new
// status filter (below) can never drift.
const entityRowColor = (entry) =>
  entry.staleness === 'error' ? 'danger' : entry.staleness === 'warning' ? 'warning' : undefined

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ok', label: 'OK' },
  { value: 'problem', label: 'Warning or Error' },
]

// AGENTS_TO_DO.md, 2026-08-16 - found live: `entries` was fetched once on
// mount and never again, so an entity going stale *after* that fetch
// never appeared in the list at all - not just an unhighlighted row, the
// entity was genuinely absent, and the new status filter (which runs
// against this same stale `entries`) then looked "broken" (a real
// problem entity, invisible until a manual page reload). Same "UI
// convenience poll, not a control loop" precedent as DevicesList.jsx's
// own DEVICES_POLL_MS/NodesList.jsx's old NODES_POLL_MS.
const HEARTBEAT_CONTROLS_POLL_MS = 10000

const iconUrl = (iconPath) => (iconPath ? `/api${iconPath}` : null)

const EntityIcon = ({ iconPath }) => {
  const url = iconUrl(iconPath)
  return url ? (
    <img src={url} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} />
  ) : (
    <CIcon icon={cilLibrary} className="text-body-secondary" />
  )
}

/**
 * Expandable-row detail for the "heartbeat-control" process kind
 * (AGENTS.md's Heartbeating Control section) - the one place this whole
 * feature's combined processes/devices/nodes list lives, per the user's
 * own spec ("в розгорнутій компоненті процесу"), not a separate page.
 * Reuses the existing pagination/search toolkit (AGENTS.md section 11)
 * rather than a bespoke one, even though the underlying data spans three
 * REST resources merged server-side into one list
 * (`GET /heartbeat-controls`).
 */
const HeartbeatControlPanel = () => {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const reload = () =>
    api
      .listHeartbeatControls()
      .then(setEntries)
      .catch((err) => setError(err.message))

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    const interval = setInterval(reload, HEARTBEAT_CONTROLS_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const handleToggleStopped = async (entry, stopped) => {
    try {
      await api.setHeartbeatStopped(entry.type, entry.id, stopped)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const resetFilters = () => {
    setTypeFilter('')
    setStatusFilter('')
    setSearch('')
  }

  // usePagination must run on every render regardless of loading/error
  // state (rules-of-hooks) - `entries ?? []` keeps it safe before the
  // first successful load.
  const filtered = (entries ?? []).filter(
    (entry) =>
      (!typeFilter || entry.type === typeFilter) &&
      (!statusFilter ||
        (statusFilter === 'ok' ? entry.staleness === 'ok' : entry.staleness !== 'ok')) &&
      (!search || entry.name.toLowerCase().includes(search.toLowerCase())),
  )
  const hasActiveFilters = Boolean(typeFilter) || Boolean(statusFilter) || Boolean(search)
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: 10,
  })

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!entries) return <CSpinner size="sm" />

  return (
    <div className="pt-0 pb-3 px-2">
      <CRow className="mb-3 g-2 align-items-center">
        <CCol xs="auto">
          <CFormSelect
            size="sm"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All</option>
            <option value="process">Processes</option>
            <option value="device">Devices</option>
            <option value="node">Nodes</option>
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <CFormSelect
            size="sm"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            aria-label="Filter by status"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <TableSearchInput value={search} onSearch={setSearch} placeholder="Search by name..." />
        </CCol>
        <CCol className="d-flex justify-content-end gap-2">
          <IconButton icon={cilReload} size="sm" center onClick={reload} ariaLabel="Reload" />
          <ResetFiltersButton active={hasActiveFilters} onClick={resetFilters} />
        </CCol>
      </CRow>

      {pageItems.length === 0 ? (
        <CAlert color="info">
          {entries.length === 0
            ? 'Nothing is heartbeat-monitored yet.'
            : 'No entities match this filter.'}
        </CAlert>
      ) : (
        <>
          <CTable hover responsive small>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell style={{ width: 40 }}></CTableHeaderCell>
                <CTableHeaderCell>Name</CTableHeaderCell>
                <CTableHeaderCell>Type</CTableHeaderCell>
                <CTableHeaderCell>Warning</CTableHeaderCell>
                <CTableHeaderCell>Error</CTableHeaderCell>
                <CTableHeaderCell className="text-end">Actions</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {pageItems.map((entry) => (
                <CTableRow key={`${entry.type}:${entry.id}`} color={entityRowColor(entry)}>
                  <CTableDataCell>
                    <EntityIcon iconPath={entry.iconPath} />
                  </CTableDataCell>
                  <CTableDataCell>{entry.name}</CTableDataCell>
                  <CTableDataCell>{TYPE_LABEL[entry.type]}</CTableDataCell>
                  <CTableDataCell>{formatThreshold(entry.heartbeatControl.warning)}</CTableDataCell>
                  <CTableDataCell>{formatThreshold(entry.heartbeatControl.error)}</CTableDataCell>
                  <CTableDataCell className="text-end">
                    <div className="d-flex justify-content-end align-items-center gap-2">
                      <IconButton
                        icon={cilSettings}
                        size="sm"
                        center
                        ariaLabel={`Edit heartbeat thresholds for ${entry.name}`}
                        onClick={() => setEditing(entry)}
                      />
                      <Switch
                        checked={!entry.stopped}
                        disabled={!entry.heartbeatControl.stoppable}
                        onChange={(next) => handleToggleStopped(entry, !next)}
                        ariaLabel={
                          entry.stopped
                            ? `Resume monitoring ${entry.name}`
                            : `Pause monitoring ${entry.name}`
                        }
                      />
                    </div>
                  </CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
          <TablePagination
            page={page}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      {editing && (
        <HeartbeatEditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

export default HeartbeatControlPanel
