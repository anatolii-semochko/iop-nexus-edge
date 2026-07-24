import React from 'react'
import { CFormSelect, CPagination, CPaginationItem } from '@coreui/react'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50]

// How many numbered page links to show around the current page before
// collapsing the rest - keeps the control a fixed, reasonable width even
// with dozens of pages, same purpose as sevenstime-backoffice's Paginator
// (AGENTS.md section 12), reimplemented against CoreUI's plain CPagination
// rather than copied.
const MAX_VISIBLE_PAGES = 5

function visiblePageNumbers(page, totalPages) {
  let start = Math.max(1, page - Math.floor(MAX_VISIBLE_PAGES / 2))
  const end = Math.min(totalPages, start + MAX_VISIBLE_PAGES - 1)
  start = Math.max(1, end - MAX_VISIBLE_PAGES + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

/**
 * Controlled pagination bar: page-size picker, "showing X-Y of Z" info, and
 * numbered page controls. Owns no state of its own - pair it with
 * `apps/ui/src/hooks/usePagination.js` (AGENTS.md section 12).
 */
const TablePagination = ({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const rangeStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, totalItems)

  return (
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
      <div className="d-flex align-items-center gap-2">
        <span className="text-body-secondary small">Show</span>
        <CFormSelect
          size="sm"
          style={{ width: 'auto' }}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </CFormSelect>
        <span className="text-body-secondary small">
          {rangeStart}-{rangeEnd} of {totalItems}
        </span>
      </div>
      {totalPages > 1 && (
        <CPagination size="sm" aria-label="Table pages" className="mb-0">
          <CPaginationItem disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            &laquo;
          </CPaginationItem>
          {visiblePageNumbers(page, totalPages).map((n) => (
            <CPaginationItem key={n} active={n === page} onClick={() => onPageChange(n)}>
              {n}
            </CPaginationItem>
          ))}
          <CPaginationItem disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            &raquo;
          </CPaginationItem>
        </CPagination>
      )}
    </div>
  )
}

export default TablePagination
