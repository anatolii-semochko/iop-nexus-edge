import React from 'react'
import {
  CAlert,
  CAvatar,
  CBadge,
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
import { WEM_TYPE_META } from '../../components/header/wemTypeMeta'
import DateRangeFilter from '../../components/table/DateRangeFilter'
import IconButton from '../../components/IconButton'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useServerPaginatedList } from '../../hooks/useServerPaginatedList'
import { formatSmartDateTime, localDateTimeToIso, userInitials } from '../../utils/format'

const TYPE_OPTIONS = [
  { key: 'all', label: 'All types' },
  ...Object.entries(WEM_TYPE_META).map(([key, meta]) => ({ key, label: meta.label })),
]
const PAGE_SIZE_OPTIONS = [20, 50, 100]

/**
 * Logs page (AGENTS.md section 29) - Messages tab. Read-only historical
 * view of process_messages (every WEM entry ever raised, including
 * resolved/hidden ones) - unlike the header notification center popup
 * (section 25), there's no mark-as-read action here; this is a full audit
 * trail, not an inbox. Reuses GET /log-messages (`scope: 'all'`)
 * rather than a separate endpoint, since that's already exactly this data.
 *
 * Filter/search/date-range/pageSize values and their setters are
 * controlled props (2026-08-01) - see CommandLogsTab.jsx's identical doc
 * comment for why.
 */
const ProcessMessageLogsTab = ({
  processes,
  type,
  processId,
  search,
  from,
  to,
  pageSize: initialPageSize,
  onTypeChange,
  onProcessIdChange,
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
        api.listProcessMessages({
          type,
          scope: 'all',
          processId: processId || undefined,
          search: search || undefined,
          from: localDateTimeToIso(from),
          to: localDateTimeToIso(to),
          page: pageArg,
          pageSize: pageSizeArg,
        }),
      [type, processId, search, from, to],
      { pageSize: initialPageSize, onPageSizeChange },
    )

  const hasActiveFilters = Boolean(type !== 'all' || processId || search || from || to)

  return (
    <>
      <CRow className="mb-2 mx-1 g-2 align-items-center">
        <CCol xs="auto">
          <CFormSelect size="sm" value={type} onChange={(e) => onTypeChange(e.target.value)}>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <CFormSelect
            size="sm"
            value={processId}
            onChange={(e) => onProcessIdChange(e.target.value)}
          >
            <option value="">All processes</option>
            {processes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <TableSearchInput
            key={searchResetToken}
            value={search}
            onSearch={onSearchChange}
            placeholder="Search by text..."
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
        <CAlert color="info">No process messages match this filter.</CAlert>
      ) : (
        <>
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Group</CTableHeaderCell>
                <CTableHeaderCell scope="col">Process</CTableHeaderCell>
                <CTableHeaderCell scope="col">Message</CTableHeaderCell>
                <CTableHeaderCell scope="col" className="text-end">
                  Status
                </CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {items.map((item) => (
                <CTableRow key={item.id}>
                  <CTableDataCell className="text-body-secondary small text-nowrap">
                    {formatSmartDateTime(item.created_at)}
                  </CTableDataCell>
                  <CTableDataCell>{item.group_name}</CTableDataCell>
                  <CTableDataCell>{item.process_name}</CTableDataCell>
                  <CTableDataCell className={`text-${WEM_TYPE_META[item.type].color}`}>
                    {item.text}
                  </CTableDataCell>
                  <CTableDataCell className="text-end">
                    {item.hidden ? (
                      item.hidden_by_user ? (
                        <span
                          title={`${item.hidden_by_user.display_name ?? item.hidden_by_user.username} · ${formatSmartDateTime(item.hidden_at)}`}
                        >
                          {item.hidden_by_user.avatar_path ? (
                            <CAvatar
                              src={`/api/uploads/avatars/${item.hidden_by_user.avatar_path}`}
                              size="sm"
                            />
                          ) : (
                            <CAvatar color="secondary" textColor="white" size="sm">
                              {userInitials(item.hidden_by_user)}
                            </CAvatar>
                          )}
                        </span>
                      ) : (
                        <CBadge color="secondary">Read</CBadge>
                      )
                    ) : (
                      <CBadge color="info">Unread</CBadge>
                    )}
                  </CTableDataCell>
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

export default ProcessMessageLogsTab
