import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CCol,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { cilSettings } from '@coreui/icons'
import { api } from '../../api/client'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import Switch from '../../components/Switch'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'
import DataLoggerEditModal from './DataLoggerEditModal'

const formatThreshold = (threshold) =>
  threshold ? `${threshold.numberSkippedPeriods} period(s) → level ${threshold.level}` : 'off'

const formatPeriod = (periodSeconds) => (periodSeconds === null ? '—' : `${periodSeconds}s`)

/**
 * Expandable-row detail for the "data-logger" process kind (AGENTS.md's
 * Data Logger section, Heartbeating Control used as the explicit
 * architectural template) - Devices only (a Node has no value of its own
 * to log), plus this process's own two global switches at the top.
 */
const DataLoggerPanel = () => {
  const [settings, setSettings] = useState(null)
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const reload = () => {
    Promise.all([api.getDataLoggerSettings(), api.listDataLoggerControls()])
      .then(([nextSettings, nextEntries]) => {
        setSettings(nextSettings)
        setEntries(nextEntries)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    reload()
  }, [])

  const handleToggleSetting = async (key, next) => {
    try {
      await api.updateDataLoggerSettings({ [key]: next })
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleToggleWriteEnabled = async (entry, next) => {
    try {
      await api.setDataLoggerWriteEnabled(entry.id, next)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const resetFilters = () => setSearch('')

  // usePagination must run on every render regardless of loading/error
  // state (rules-of-hooks) - `entries ?? []` keeps it safe before the
  // first successful load.
  const filtered = (entries ?? []).filter(
    (entry) => !search || entry.name.toLowerCase().includes(search.toLowerCase()),
  )
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: 10,
  })

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!settings || !entries) return <CSpinner size="sm" />

  return (
    <div className="p-3 pt-0">
      <CRow className="mb-3 g-3 align-items-center">
        <CCol xs="auto" className="d-flex align-items-center gap-2">
          <Switch
            checked={settings.errorWarningEnabled}
            onChange={(next) => handleToggleSetting('errorWarningEnabled', next)}
            ariaLabel="Toggle overdue-value warning/error messages"
          />
          <span className="small text-body-secondary">
            Warning/error messages for overdue values
          </span>
        </CCol>
        <CCol xs="auto" className="d-flex align-items-center gap-2">
          <Switch
            checked={settings.tickLoggingEnabled}
            onChange={(next) => handleToggleSetting('tickLoggingEnabled', next)}
            ariaLabel="Toggle tick-resolution logging"
          />
          <span className="small text-body-secondary">
            Log every tick (1s) for devices configured that fast
          </span>
        </CCol>
      </CRow>

      <CRow className="mb-3 g-2 align-items-center">
        <CCol xs="auto">
          <TableSearchInput value={search} onSearch={setSearch} placeholder="Search by name..." />
        </CCol>
        <CCol className="d-flex justify-content-end">
          <ResetFiltersButton active={Boolean(search)} onClick={resetFilters} />
        </CCol>
      </CRow>

      {pageItems.length === 0 ? (
        <CAlert color="info">
          {entries.length === 0 ? 'No devices to log yet.' : 'No devices match this filter.'}
        </CAlert>
      ) : (
        <>
          <CTable hover responsive small>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell>Name</CTableHeaderCell>
                <CTableHeaderCell>Period</CTableHeaderCell>
                <CTableHeaderCell>Warning</CTableHeaderCell>
                <CTableHeaderCell>Error</CTableHeaderCell>
                <CTableHeaderCell className="text-end">Actions</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {pageItems.map((entry) => (
                <CTableRow key={entry.id}>
                  <CTableDataCell>{entry.name}</CTableDataCell>
                  <CTableDataCell>
                    {formatPeriod(entry.dataLoggerControl.periodSeconds)}
                  </CTableDataCell>
                  <CTableDataCell>
                    {formatThreshold(entry.dataLoggerControl.warning)}
                  </CTableDataCell>
                  <CTableDataCell>{formatThreshold(entry.dataLoggerControl.error)}</CTableDataCell>
                  <CTableDataCell className="text-end">
                    <div className="d-flex justify-content-end align-items-center gap-2">
                      <IconButton
                        icon={cilSettings}
                        size="sm"
                        center
                        ariaLabel={`Edit data logging for ${entry.name}`}
                        onClick={() => setEditing(entry)}
                      />
                      <Switch
                        checked={entry.dataLoggerControl.writeEnabled}
                        disabled={entry.dataLoggerControl.periodSeconds === null}
                        onChange={(next) => handleToggleWriteEnabled(entry, next)}
                        ariaLabel={
                          entry.dataLoggerControl.writeEnabled
                            ? `Ignore ${entry.name}`
                            : `Write ${entry.name}`
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
        <DataLoggerEditModal
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

export default DataLoggerPanel
