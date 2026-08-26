import React from 'react'
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
 * Logs page (AGENTS.md section 29) - devices tab. Read side of
 * `log_device` (renamed from `sensor_reading_logs`, AGENTS_TO_DO.md's
 * 2026-07-27 Device/Node refactor) - every readOnly device reading, logged
 * unconditionally while a producer existed. As of that same refactor, no
 * producer calls this anymore (dualDevicesModel.publishReading no longer
 * logs - a future configurable process will decide what/when to log); this
 * tab still reads whatever history already exists. No Resource column
 * anymore - a Device is atomic, its name already says what was read.
 *
 * Filter/search/date-range/pageSize values and their setters are
 * controlled props (2026-08-01) - see CommandLogsTab.jsx's identical doc
 * comment for why.
 */
const DeviceLogsTab = ({
  devices,
  deviceId,
  search,
  from,
  to,
  pageSize: initialPageSize,
  onDeviceIdChange,
  onSearchChange,
  onFromChange,
  onToChange,
  onPageSizeChange,
  searchResetToken,
  onResetFilters,
}) => {
  const { items, total, loading, error, page, pageSize, setPage, setPageSize, reload } =
    useServerPaginatedList(
      (pageArg, pageSizeArg) =>
        api.listDeviceLogs({
          deviceId: deviceId || undefined,
          search: search || undefined,
          from: localDateTimeToIso(from),
          to: localDateTimeToIso(to),
          page: pageArg,
          pageSize: pageSizeArg,
        }),
      [deviceId, search, from, to],
      { pageSize: initialPageSize, onPageSizeChange },
    )

  const hasActiveFilters = Boolean(deviceId || search || from || to)

  return (
    <>
      <CRow className="mb-2 mx-1 g-2 align-items-center">
        <CCol xs="auto">
          <CFormSelect
            size="sm"
            value={deviceId}
            onChange={(e) => onDeviceIdChange(e.target.value)}
          >
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
            onSearch={onSearchChange}
            placeholder="Search by device..."
          />
        </CCol>
        <DateRangeFilter from={from} to={to} onFromChange={onFromChange} onToChange={onToChange} />
        <CCol className="d-flex justify-content-end gap-2">
          <IconButton icon={cilReload} size="sm" center onClick={reload} ariaLabel="Reload" />
          <ResetFiltersButton active={hasActiveFilters} onClick={onResetFilters} />
        </CCol>
      </CRow>

      {error && <CAlert color="danger">{error}</CAlert>}

      {loading ? (
        <div className="text-center py-5">
          <CSpinner color="primary" />
        </div>
      ) : items.length === 0 ? (
        <CAlert color="info" className={'mt-3'}>No device logs match this filter.</CAlert>
      ) : (
        <>
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Device</CTableHeaderCell>
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

export default DeviceLogsTab
