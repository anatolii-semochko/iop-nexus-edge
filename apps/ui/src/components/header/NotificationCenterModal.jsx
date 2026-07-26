import React, { useEffect, useMemo, useState } from 'react'
import {
  CAlert,
  CAvatar,
  CButton,
  CCol,
  CFormSelect,
  CModal,
  CModalBody,
  CModalHeader,
  CModalTitle,
  CNav,
  CNavItem,
  CNavLink,
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
import { cilBell, cilReload, cilX } from '@coreui/icons'
import { api } from '../../api/client'
import { useProcessesLiveState } from '../../api/useLiveProcess'
import { formatSmartDateTime } from '../../utils/format'
import IconButton from '../IconButton'
import TablePagination from '../table/TablePagination'
import TableSearchInput from '../table/TableSearchInput'
import { WEM_TYPE_META } from './wemTypeMeta'

// The modal's own type selector, not the header icons' (NotificationCenter.
// jsx) - "All" only makes sense as something to *view*, it has no unread
// count or blink state of its own, so it stays out of WEM_TYPE_META.
const TYPE_OPTIONS = [
  { key: 'all', icon: cilBell, color: 'secondary', label: 'All' },
  ...Object.entries(WEM_TYPE_META).map(([key, meta]) => ({ key, ...meta })),
]

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'new', label: 'New' },
  { key: 'all', label: 'All' },
]

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const DEFAULT_PAGE_SIZE = 20

const initials = (user) =>
  (user.display_name ?? user.username)
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

/**
 * Notification center popup (AGENTS.md section 25) - opened from the
 * header icons (NotificationCenter.jsx), one per WEM type, or "All" via
 * the in-modal type selector. `type` also doubles as the modal's visible/
 * hidden flag (`null` = closed).
 *
 * Fixed height (the outer flex column below, not CModal's own `scrollable`
 * prop) regardless of tab/content - an earlier version let the modal grow
 * and shrink with whatever the current tab happened to return, which made
 * switching tabs visibly jump the whole popup's height around.
 *
 * Three tabs, not two: "Active" reads *live* process state
 * (`useProcessesLiveState`, AGENTS.md section 24) - every process's own
 * `messages` array is already exactly "currently active, unhidden" per
 * process, so no REST call/pagination for it at all, just a client-side
 * flatten+filter/sort. "New"/"All" still hit the server-paginated
 * `GET /process-messages` (section 11's "client-side, tens of rows"
 * doesn't hold for an append-only log). "Active" only makes UI sense for
 * warning/error (a `message` never resolves - section 22), hidden when
 * `type === 'message'`.
 */
const NotificationCenterModal = ({ type, onTypeChange, onClose }) => {
  const [tab, setTab] = useState('new')
  const [processFilter, setProcessFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [processes, setProcesses] = useState([])

  // Fetched once, not per-open - cheap (a few dozen rows) and needed both
  // for the process filter dropdown and for naming the live Active tab's
  // entries (which carry a process id but not its name).
  useEffect(() => {
    api
      .listProcesses()
      .then(setProcesses)
      .catch(() => {}) // the filter dropdown/names just degrade to ids - not worth its own error banner
  }, [])
  const processNameById = useMemo(() => new Map(processes.map((p) => [p.id, p.name])), [processes])

  // "Active" only means something for warning/error - computed, not
  // synced back into `tab` via an effect (see NotificationCenterModal's
  // sibling doc comment on this same pattern elsewhere in this app).
  const effectiveTab = tab === 'active' && type === 'message' ? 'new' : tab
  const visibleTabs = TABS.filter((t) => !(t.key === 'active' && type === 'message'))

  const live = useProcessesLiveState()
  const activeItems = useMemo(() => {
    const flattened = []
    for (const [processIdKey, state] of Object.entries(live)) {
      const processId = Number(processIdKey)
      for (const message of state.messages ?? []) {
        if (message.type === 'message') continue // no "active" concept for a one-shot message
        flattened.push({
          ...message,
          process_id: processId,
          process_name: processNameById.get(processId) ?? `#${processId}`,
        })
      }
    }
    return flattened
      .filter((m) => type === 'all' || m.type === type)
      .filter((m) => !processFilter || m.process_id === Number(processFilter))
      .filter((m) => !search || m.text.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [live, processNameById, type, processFilter, search])

  // Every filter setter resets `page` to 1 in the same event handler that
  // changes the filter, not a separate effect watching for the change - a
  // stale page number from a larger previous result set could point past
  // the end of a new one, but that's a direct consequence of the user's
  // own click, not derived state to reconcile after the fact.
  const changeType = (nextType) => {
    setPage(1)
    onTypeChange(nextType)
  }
  const changeTab = (nextTab) => {
    setPage(1)
    setTab(nextTab)
  }
  const changeProcessFilter = (nextProcessFilter) => {
    setPage(1)
    setProcessFilter(nextProcessFilter)
  }
  const changeSearch = (nextSearch) => {
    setPage(1)
    setSearch(nextSearch)
  }
  const changePageSize = (nextPageSize) => {
    setPage(1)
    setPageSize(nextPageSize)
  }

  useEffect(() => {
    if (!type || effectiveTab === 'active') return
    let cancelled = false
    // setLoading/setError here are the effect's whole job, not incidental -
    // synchronizing "a fetch tied to these dependencies is in flight" with
    // the dependencies changing is exactly what this effect exists to do.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    api
      .listProcessMessages({
        type,
        scope: effectiveTab,
        processId: processFilter || undefined,
        search: search || undefined,
        page,
        pageSize,
      })
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
  }, [type, effectiveTab, processFilter, search, page, pageSize, reloadToken])

  const handleDismiss = async (messageId) => {
    try {
      // Dismissing from the Active tab needs no explicit refetch - the
      // live process-state broadcast (section 24) already drops the entry
      // from that process's `messages` array the moment the server-side
      // hidden flip lands, which is exactly what `activeItems` above is
      // derived from. Only the REST-backed New/All tabs need the token
      // bump, harmless to bump unconditionally either way.
      await api.hideMessage(messageId)
      setReloadToken((t) => t + 1)
    } catch (err) {
      setError(err.message)
    }
  }

  const rows = effectiveTab === 'active' ? activeItems : items

  return (
    <CModal visible={Boolean(type)} onClose={onClose} size="xl" alignment="center">
      <CModalHeader>
        <CModalTitle>Notifications</CModalTitle>
      </CModalHeader>
      <CModalBody className="d-flex flex-column" style={{ height: '70vh' }}>
        {type && (
          <>
            <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
              <div className="btn-group" role="group">
                {TYPE_OPTIONS.map((option) => (
                  <CButton
                    key={option.key}
                    size="sm"
                    color={option.color}
                    variant={type === option.key ? undefined : 'outline'}
                    onClick={() => changeType(option.key)}
                  >
                    <CIcon icon={option.icon} className="me-1" />
                    {option.label}
                  </CButton>
                ))}
              </div>
              <IconButton
                icon={cilReload}
                size="sm"
                center
                onClick={() => setReloadToken((t) => t + 1)}
                ariaLabel="Reload"
              />
            </div>

            <CNav variant="tabs" role="tablist" className="mb-3">
              {visibleTabs.map((t) => (
                <CNavItem key={t.key}>
                  <CNavLink
                    active={effectiveTab === t.key}
                    style={{ cursor: 'pointer' }}
                    onClick={() => changeTab(t.key)}
                  >
                    {t.label}
                  </CNavLink>
                </CNavItem>
              ))}
            </CNav>

            <CRow className="mb-3 g-2">
              <CCol xs="auto">
                <CFormSelect
                  size="sm"
                  value={processFilter}
                  onChange={(e) => changeProcessFilter(e.target.value)}
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
                  value={search}
                  onSearch={changeSearch}
                  placeholder="Search by text..."
                />
              </CCol>
            </CRow>

            {error && <CAlert color="danger">{error}</CAlert>}

            <div className="flex-grow-1 overflow-auto">
              {loading ? (
                <div className="text-center py-5">
                  <CSpinner color="primary" />
                </div>
              ) : rows.length === 0 ? (
                <CAlert color="info">Nothing here.</CAlert>
              ) : (
                <CTable responsive hover>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell>Time</CTableHeaderCell>
                      <CTableHeaderCell>Process</CTableHeaderCell>
                      <CTableHeaderCell>Message</CTableHeaderCell>
                      <CTableHeaderCell className="text-end">Status</CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {rows.map((item) => (
                      <CTableRow key={item.id}>
                        <CTableDataCell className="text-body-secondary small text-nowrap">
                          {formatSmartDateTime(item.created_at)}
                        </CTableDataCell>
                        <CTableDataCell>{item.process_name}</CTableDataCell>
                        <CTableDataCell className={`text-${WEM_TYPE_META[item.type].color}`}>
                          {item.text}
                        </CTableDataCell>
                        <CTableDataCell className="text-end">
                          {item.hidden ? (
                            item.hidden_by_user && (
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
                                    {initials(item.hidden_by_user)}
                                  </CAvatar>
                                )}
                              </span>
                            )
                          ) : (
                            <IconButton
                              icon={cilX}
                              size="sm"
                              center
                              onClick={() => handleDismiss(item.id)}
                              ariaLabel="Dismiss"
                            />
                          )}
                        </CTableDataCell>
                      </CTableRow>
                    ))}
                  </CTableBody>
                </CTable>
              )}
            </div>

            {effectiveTab !== 'active' && (
              <TablePagination
                page={page}
                pageSize={pageSize}
                totalItems={total}
                onPageChange={setPage}
                onPageSizeChange={changePageSize}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
              />
            )}
          </>
        )}
      </CModalBody>
    </CModal>
  )
}

export default NotificationCenterModal
