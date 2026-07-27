import React, { useState } from 'react'
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
import { cilReload } from '@coreui/icons'
import { api } from '../../api/client'
import DateRangeFilter from '../../components/table/DateRangeFilter'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useServerPaginatedList } from '../../hooks/useServerPaginatedList'
import { formatSmartDateTime, localDateTimeToIso } from '../../utils/format'

const PAGE_SIZE_OPTIONS = [20, 50, 100]

const formatValue = (value) => (value === null || value === undefined ? '-' : String(value))

/**
 * Logs page (AGENTS.md section 29) - sensors tab. Read side of
 * sensor_reading_logs (every readOnly resource publish, logged
 * unconditionally - AGENTS.md section 22), which had no query surface at
 * all before this. Historical/append-only, no per-row interaction.
 */
const SensorReadingLogsTab = ({ devices }) => {
  const [deviceId, setDeviceId] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [searchResetToken, setSearchResetToken] = useState(0)

  const { items, total, loading, error, page, pageSize, setPage, setPageSize, reload } =
    useServerPaginatedList(
      (pageArg, pageSizeArg) =>
        api.listSensorReadingLogs({
          deviceId: deviceId || undefined,
          search: search || undefined,
          from: localDateTimeToIso(from),
          to: localDateTimeToIso(to),
          page: pageArg,
          pageSize: pageSizeArg,
        }),
      [deviceId, search, from, to],
      { pageSize: PAGE_SIZE_OPTIONS[0] },
    )

  const hasActiveFilters = Boolean(deviceId || search || from || to)
  const resetFilters = () => {
    setDeviceId('')
    setSearch('')
    setFrom('')
    setTo('')
    setSearchResetToken((t) => t + 1)
  }

  return (
    <>
      <CRow className="mb-3 g-2 align-items-center">
        <CCol xs="auto">
          <CFormSelect size="sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <TableSearchInput
            key={searchResetToken}
            value={search}
            onSearch={setSearch}
            placeholder="Search by resource..."
          />
        </CCol>
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <CCol className="d-flex justify-content-end gap-2">
          <IconButton icon={cilReload} size="sm" center onClick={reload} ariaLabel="Reload" />
          <ResetFiltersButton active={hasActiveFilters} onClick={resetFilters} />
        </CCol>
      </CRow>

      {error && <CAlert color="danger">{error}</CAlert>}

      {loading ? (
        <div className="text-center py-5">
          <CSpinner color="primary" />
        </div>
      ) : items.length === 0 ? (
        <CAlert color="info">No sensor reading logs match this filter.</CAlert>
      ) : (
        <>
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Device</CTableHeaderCell>
                <CTableHeaderCell scope="col">Resource</CTableHeaderCell>
                <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Source</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {items.map((item) => (
                <CTableRow key={item.id}>
                  <CTableDataCell className="text-body-secondary small text-nowrap">
                    {formatSmartDateTime(item.created_at)}
                  </CTableDataCell>
                  <CTableDataCell>{item.device_name ?? `#${item.device_id ?? '?'}`}</CTableDataCell>
                  <CTableDataCell>{item.resource}</CTableDataCell>
                  <CTableDataCell>{formatValue(item.value)}</CTableDataCell>
                  <CTableDataCell>{item.source}</CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
          <TablePagination
            page={page}
            pageSize={pageSize}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </>
      )}
    </>
  )
}

export default SensorReadingLogsTab
