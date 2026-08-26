import React from 'react'
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

const ACTIONS = ['write', 'auto', 'release', 'simulate', 'on', 'off', 'config', 'simulated-on', 'simulated-off']
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
 * only, no per-row interaction - a straight audit trail. Actor is shown
 * inline in the Time cell (2026-08-01 follow-up).
 *
 * Filter/search/date-range/pageSize values and their setters are all
 * controlled props now (2026-08-01), not local state - LogsList.jsx owns
 * and persists them (`usePersistedState`'s tabbed variant), passing this
 * component's whole slice down via `{...tabState('commands')}` plus the
 * matching `onXChange` callbacks, the same prop-per-field convention
 * ProcessesTable.jsx already uses.
 */
const CommandLogsTab = ({
  devices,
  users,
  deviceId,
  action,
  actorUserId,
  search,
  from,
  to,
  pageSize: initialPageSize,
  onDeviceIdChange,
  onActionChange,
  onActorUserIdChange,
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
      { pageSize: initialPageSize, onPageSizeChange },
    )

  const hasActiveFilters = Boolean(deviceId || action || actorUserId || search || from || to)

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
          <CFormSelect size="sm" value={action} onChange={(e) => onActionChange(e.target.value)}>
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
            onChange={(e) => onActorUserIdChange(e.target.value)}
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
            onSearch={onSearchChange}
            placeholder="Search by device or process..."
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
