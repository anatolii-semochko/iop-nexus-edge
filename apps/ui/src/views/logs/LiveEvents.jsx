import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormSelect,
  CRow,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { subscribeToLiveEvents } from '../../api/liveSocket'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePersistedState } from '../../hooks/usePersistedState'
import LiveBadge from '../devices/LiveBadge'

// How many recent messages to keep in the buffer - client-side only (no
// pagination, no server round trip - this is a raw tap on the socket, not
// a stored log), a user-picked cap rather than a fixed constant since
// "how much history" is a tradeoff the user watching the feed should make.
const LIMIT_OPTIONS = [100, 200, 500, 1000]
const DEFAULT_LIMIT = 500

// Registration for usePersistedState (AGENTS_TO_DO.md, 2026-08-01) - flat
// variant. `limit` rides along here too even though it's deliberately
// excluded from hasActiveFilters/resetFilters below (it changes what's
// buffered, not just what's shown) - it's still a UI preference worth
// restoring, the same role `pageSize` plays on every other persisted page.
const PERSISTED_DEFAULTS = {
  domainFilter: '',
  entityFilter: '',
  modeFilter: '',
  sourceFilter: '',
  search: '',
  limit: DEFAULT_LIMIT,
}

const modeColor = (mode) => (mode === 'MANUAL' ? 'warning' : 'success')

let nextRowId = 0

// Unique, non-empty values seen so far, for a filter dropdown's option
// list - built from the buffer itself (there's no fixed universe of
// domains/entities/resources/modes/sources to seed from, unlike e.g. the
// Processes page's Process Group selector), so a value only appears once
// at least one row carrying it has actually arrived. Normalized to String
// BEFORE deduping, not after - `event.entityId` arrives as a JS number in
// the initial device-state snapshot (cached from Redis, where it's a real
// integer) but as a string in every live event after that (parsed out of
// the routing key text) - deduping first and stringifying after let both
// forms of the same id through as two distinct Set entries, producing
// visibly duplicate options (e.g. "1" twice) once rendered.
const distinctValues = (values) =>
  [
    ...new Set(
      values.filter((value) => value !== undefined && value !== null && value !== '').map(String),
    ),
  ].sort()

// Same `domain.entityId` format the table's own Entity column renders -
// the entity filter/option list uses this composed key, not the bare
// entityId, both so the dropdown's labels actually mean something (a bare
// "1" doesn't say which domain it belongs to) and so an id that happens to
// collide across domains doesn't merge into one filter option.
const entityKey = (event) => `${event.domain}.${event.entityId}`

/**
 * Raw feed of every message the shared WebSocket receives (apps/messaging-
 * gateway, AGENTS.md section 9) - unfiltered at the socket level, newest
 * first. A debugging/visibility tool for the bus itself, distinct from the
 * per-device overlays on Device Detail / Dev Simulator. Lives in the Logs
 * nav group (section 29) alongside the Logs page - it moved out of
 * Devices, its component folder didn't (still imports LiveBadge from
 * views/devices).
 *
 * Filters (domain/entity/mode/source selectors + free-text search - no
 * resource selector anymore, a Device is atomic now, AGENTS_TO_DO.md's
 * 2026-07-27 Device/Node refactor) are purely client-side over the
 * in-memory buffer above, not a server query - "Clear" still empties the
 * whole buffer; "Reset filters" (only shown once a filter is active) just
 * narrows/widens what's shown of what's already buffered.
 */
const LiveEvents = () => {
  const [rows, setRows] = useState([])
  const [pageState, setPageState] = usePersistedState(
    'nexusedge.liveEventsPage',
    PERSISTED_DEFAULTS,
  )
  const { domainFilter, entityFilter, modeFilter, sourceFilter, search, limit } = pageState
  const setDomainFilter = (value) => setPageState({ domainFilter: value })
  const setEntityFilter = (value) => setPageState({ entityFilter: value })
  const setModeFilter = (value) => setPageState({ modeFilter: value })
  const setSourceFilter = (value) => setPageState({ sourceFilter: value })
  const setSearch = (value) => setPageState({ search: value })
  // The subscription effect below reads this instead of `limit` directly
  // so changing the limit doesn't need to unsubscribe/resubscribe from the
  // socket - only `changeLimit` (a plain event handler, not an effect)
  // needs to react to the change, by trimming the buffer immediately.
  // Seeded from the persisted value, not the module default, so a
  // restored buffer-size preference applies from the very first live
  // event, not only after the next manual change.
  const limitRef = useRef(limit)
  // Bumped on reset to force TableSearchInput to remount with a blank
  // value - same pattern already established elsewhere (it owns its own
  // typing state after mount and never resyncs from a changed `value` prop).
  // Not itself persisted - a remount trigger, not meaningful state.
  const [searchResetToken, setSearchResetToken] = useState(0)

  useEffect(
    () =>
      subscribeToLiveEvents(({ routingKey, event }) => {
        setRows((prev) =>
          [{ id: nextRowId++, routingKey, event }, ...prev].slice(0, limitRef.current),
        )
      }),
    [],
  )

  // Not a filter (excluded from hasActiveFilters/resetFilters below) - this
  // changes what's actually kept in the buffer, not just what's shown of
  // it. Trims the existing buffer right away rather than waiting for it to
  // shrink naturally as old rows age out, so lowering the limit has an
  // immediate, visible effect.
  const changeLimit = (nextLimit) => {
    limitRef.current = nextLimit
    setPageState({ limit: nextLimit })
    setRows((prev) => prev.slice(0, nextLimit))
  }

  const domains = useMemo(() => distinctValues(rows.map((row) => row.event.domain)), [rows])
  const entities = useMemo(
    () =>
      distinctValues(
        rows
          .filter(
            (row) =>
              row.event.entityId !== undefined &&
              row.event.entityId !== null &&
              row.event.entityId !== '',
          )
          .map((row) => entityKey(row.event)),
      ),
    [rows],
  )
  const modes = useMemo(() => distinctValues(rows.map((row) => row.event.mode)), [rows])
  const sources = useMemo(() => distinctValues(rows.map((row) => row.event.source)), [rows])

  const filtered = rows.filter(({ routingKey, event }) => {
    if (domainFilter && event.domain !== domainFilter) return false
    if (entityFilter && entityKey(event) !== entityFilter) return false
    if (modeFilter && event.mode !== modeFilter) return false
    if (sourceFilter && event.source !== sourceFilter) return false
    if (search) {
      const haystack = [
        routingKey,
        event.domain,
        event.entityId,
        event.value,
        event.mode,
        event.source,
      ]
        .filter((value) => value !== undefined && value !== null)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search.toLowerCase())) return false
    }
    return true
  })

  const hasActiveFilters = Boolean(
    domainFilter || entityFilter || modeFilter || sourceFilter || search,
  )
  const resetFilters = () => {
    setPageState({
      domainFilter: '',
      entityFilter: '',
      modeFilter: '',
      sourceFilter: '',
      search: '',
    })
    setSearchResetToken((t) => t + 1)
  }

  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center gap-2">
          <strong>Live Events</strong>
          <small>last</small>
          <CFormSelect
            size="sm"
            className="w-auto d-inline-block"
            value={limit}
            onChange={(e) => changeLimit(Number(e.target.value))}
            aria-label="Buffer size"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </CFormSelect>
          <LiveBadge />
        </div>
        <CButton size="sm" color="secondary" variant="outline" onClick={() => setRows([])}>
          Clear
        </CButton>
      </CCardHeader>
      <CCardBody>
        <CRow className="mb-3 g-2 align-items-center">
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
            >
              <option value="">All domains</option>
              {domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              <option value="">All entities</option>
              {entities.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
            >
              <option value="">All modes</option>
              {modes.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <CFormSelect
              size="sm"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </CFormSelect>
          </CCol>
          <CCol xs="auto">
            <TableSearchInput
              key={searchResetToken}
              value={search}
              onSearch={setSearch}
              placeholder="Search..."
            />
          </CCol>
          <CCol className="d-flex justify-content-end">
            <ResetFiltersButton active={hasActiveFilters} onClick={resetFilters} />
          </CCol>
        </CRow>

        {rows.length === 0 ? (
          <p className="text-body-secondary mb-0">No messages yet - waiting for live events...</p>
        ) : filtered.length === 0 ? (
          <CAlert color="info">No events match this filter.</CAlert>
        ) : (
          <CTable hover responsive small>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Routing key</CTableHeaderCell>
                <CTableHeaderCell scope="col">Entity</CTableHeaderCell>
                <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Mode</CTableHeaderCell>
                <CTableHeaderCell scope="col">Source</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {filtered.map((row) => (
                <CTableRow key={row.id}>
                  <CTableDataCell>
                    <code>{row.event.timestamp ?? '-'}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    <code>{row.routingKey}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    {row.event.domain}.{row.event.entityId}
                  </CTableDataCell>
                  <CTableDataCell>
                    {row.event.value !== undefined ? String(row.event.value) : '-'}
                  </CTableDataCell>
                  <CTableDataCell>
                    {row.event.mode ? (
                      <CBadge color={modeColor(row.event.mode)}>{row.event.mode}</CBadge>
                    ) : (
                      '-'
                    )}
                  </CTableDataCell>
                  <CTableDataCell>{row.event.source ?? '-'}</CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default LiveEvents
