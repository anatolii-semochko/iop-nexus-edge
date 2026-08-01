import React, { useState } from 'react'
import {
  CAlert,
  CAvatar,
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
import { formatSmartDateTime, localDateTimeToIso, userInitials } from '../../utils/format'

const ACTIONS = ['write', 'auto', 'release', 'simulate', 'on', 'off', 'config']
const PAGE_SIZE_OPTIONS = [20, 50, 100]

const formatValue = (value) => {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Who issued this command (AGENTS_TO_DO.md, 2026-08-01) - the orchestrator
// IS the "system" user (routes/users.ts's protected service account, also
// AGENTS_TO_DO.md 2026-08-01: "system... Це і є оркестратор"), not a
// separate synthetic actor - it renders exactly like any other user here,
// its own avatar included, no special-casing. Only a legacy row predating
// actor_user_id existing at all (migration 1690000000039's backfill had
// no way to know which human issued an old write/release/simulate
// command) has no `actorUser` to show.
const ActorCell = ({ actorUser }) => {
  if (!actorUser) {
    return (
      <span title="Unknown user">
        <CAvatar color="secondary" textColor="white" size="sm">
          ?
        </CAvatar>
      </span>
    )
  }
  return (
    <span title={actorUser.display_name ?? actorUser.username}>
      {actorUser.avatar_path ? (
        <CAvatar src={`/api/uploads/avatars/${actorUser.avatar_path}`} size="sm" />
      ) : (
        <CAvatar color="secondary" textColor="white" size="sm">
          {userInitials(actorUser)}
        </CAvatar>
      )}
    </span>
  )
}

/**
 * Logs page (AGENTS.md section 29/36/38) - commands tab. Read side of
 * `log_command` (renamed from `device_command_logs`, AGENTS_TO_DO.md's
 * 2026-07-27 Device/Node refactor) - widened 2026-08-01 to cover process
 * actions (ON/OFF, config changes) alongside device writes, and to show
 * WHO issued each one - the orchestrator included, attributed to the real
 * "system" user rather than a separate filter entry. Historical/append-
 * only, no per-row interaction - a straight audit trail. Actor is the
 * first column (2026-08-01 follow-up), not last - who did it matters more
 * at a glance than the timestamp.
 */
const CommandLogsTab = ({ devices, users }) => {
  const [deviceId, setDeviceId] = useState('')
  const [action, setAction] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [searchResetToken, setSearchResetToken] = useState(0)

  const { items, total, loading, error, page, pageSize, setPage, setPageSize, reload } =
    useServerPaginatedList(
      (pageArg, pageSizeArg) =>
        api.listCommandLogs({
          deviceId: deviceId || undefined,
          action: action || undefined,
          actorUserId: actorUserId || undefined,
          search: search || undefined,
          from: localDateTimeToIso(from),
          to: localDateTimeToIso(to),
          page: pageArg,
          pageSize: pageSizeArg,
        }),
      [deviceId, action, actorUserId, search, from, to],
      { pageSize: PAGE_SIZE_OPTIONS[0] },
    )

  const hasActiveFilters = Boolean(deviceId || action || actorUserId || search || from || to)
  const resetFilters = () => {
    setDeviceId('')
    setAction('')
    setActorUserId('')
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
          <CFormSelect size="sm" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <CFormSelect
            size="sm"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name ?? u.username}
              </option>
            ))}
          </CFormSelect>
        </CCol>
        <CCol xs="auto">
          <TableSearchInput
            key={searchResetToken}
            value={search}
            onSearch={setSearch}
            placeholder="Search by device or process..."
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
        <CAlert color="info">No command logs match this filter.</CAlert>
      ) : (
        <>
          <CTable responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Target</CTableHeaderCell>
                <CTableHeaderCell scope="col">Action</CTableHeaderCell>
                <CTableHeaderCell scope="col">Value</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {items.map((item) => (
                <CTableRow key={item.id}>
                  <CTableDataCell className="text-body-secondary small text-nowrap">
                    <span className="me-3">
                      <ActorCell actorUser={item.actor_user} />
                    </span>
                    {formatSmartDateTime(item.created_at)}
                  </CTableDataCell>
                  <CTableDataCell>
                    {item.device_name ??
                      item.process_name ??
                      `#${item.device_id ?? item.process_id ?? '?'}`}
                  </CTableDataCell>
                  <CTableDataCell>{item.action}</CTableDataCell>
                  <CTableDataCell>{formatValue(item.value)}</CTableDataCell>
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

export default CommandLogsTab
