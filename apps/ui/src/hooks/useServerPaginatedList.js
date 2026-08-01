import { useEffect, useRef, useState } from 'react'

const DEFAULT_PAGE_SIZE = 20

/**
 * Shared server-side paginated list state (fetch on filter/page/pageSize
 * change, loading/error/reload) - the same hand-rolled shape
 * NotificationCenterModal.jsx already uses for GET /log-messages,
 * factored out here since the Logs page (AGENTS.md section 29) needs the
 * identical pattern three more times. Distinct from `usePagination.js`
 * (client-side slicing of an already-fetched array) - this one owns the
 * actual network round trip.
 *
 * `fetcher(page, pageSize)` - the caller closes over its own filter state
 * (device/type/search/date-range etc). `deps` is that filter state's own
 * values, as a plain array - changing any of them both re-fetches and
 * resets `page` back to 1, same as every filter setter in
 * NotificationCenterModal/ProcessesTable already does by hand.
 *
 * `onPageSizeChange` mirrors `usePagination.js`'s own callback of the same
 * name (AGENTS_TO_DO.md, 2026-08-01) - a plain notification hook, fired
 * whenever `setPageSize` changes the size, for a caller that wants to
 * persist the new value (this hook itself has no opinion on where a
 * caller's page size preference lives).
 */
export function useServerPaginatedList(
  fetcher,
  deps,
  { pageSize: initialPageSize = DEFAULT_PAGE_SIZE, onPageSizeChange } = {},
) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  // A serialized snapshot of the caller's filter values - simpler and
  // lint-friendly compared to spreading a variable-length `deps` array
  // directly into a dependency list (which the exhaustive-deps rule can't
  // statically verify).
  const depsKey = JSON.stringify(deps)

  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    setPage(1)
  }, [depsKey])

  useEffect(() => {
    let cancelled = false
    // setLoading/setError here are the effect's whole job, same reasoning
    // as NotificationCenterModal.jsx's own identical effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    fetcher(page, pageSize)
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `fetcher` closes over the caller's current filter values, already
    // represented here by `depsKey` - depending on both would refetch on
    // every render, since a caller's inline fetcher is a fresh closure
    // each time regardless of whether its captured values actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, reloadToken, depsKey])

  return {
    items,
    total,
    loading,
    error,
    page,
    pageSize,
    setPage,
    setPageSize: (size) => {
      setPageSize(size)
      setPage(1)
      onPageSizeChange?.(size)
    },
    reload: () => setReloadToken((t) => t + 1),
  }
}
