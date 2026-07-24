import { useMemo, useState } from 'react'

const DEFAULT_PAGE_SIZE = 10

/**
 * Client-side pagination over an already-filtered array (AGENTS.md section
 * 12 - list volumes here are tens of rows, not thousands, so slicing an
 * in-memory array is simpler and cheaper than round-tripping page/limit to
 * every list endpoint). Callers only need to slice their own data by
 * whatever predicate they like *before* passing it in - this hook never
 * touches filtering.
 *
 * `page` is clamped against the current `totalPages` on every read rather
 * than stored pre-clamped, so shrinking the input (typing a search term,
 * picking a narrower dropdown filter) can never strand the caller on a page
 * that no longer exists - no "reset page to 1 on filter change" boilerplate
 * required in the view.
 */
export function usePagination(items, { pageSize: initialPageSize = DEFAULT_PAGE_SIZE } = {}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(page, totalPages)

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, currentPage, pageSize])

  return {
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    pageItems,
    setPage,
    // Changing page size while on, say, page 5 could otherwise land the
    // user on a page number that no longer makes sense - jump back to 1.
    setPageSize: (size) => {
      setPageSize(size)
      setPage(1)
    },
  }
}
