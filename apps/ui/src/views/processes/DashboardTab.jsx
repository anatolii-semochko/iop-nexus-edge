import React from 'react'
import { CAlert } from '@coreui/react'
import { cilX } from '@coreui/icons'
import { api } from '../../api/client'
import { useProcessesLiveState } from '../../api/useLiveProcess'
import IconButton from '../../components/IconButton'
import ProcessesTable from './ProcessesTable'

/**
 * Dashboard tab (AGENTS.md section 22/24) - every process that has *ever*
 * had an active WEM entry since last cleared, regardless of whether it's
 * still active right now. A process lands here the instant it gets its
 * first active entry (apps/api's processMessages.maybeFlagForDashboard) and
 * stays - the remove X only becomes clickable once it's genuinely back to
 * zero active entries (`process.hasActiveWem === false`), enforced
 * server-side too (DELETE .../dashboard-flag 400s otherwise).
 *
 * Eligibility (`dashboard_flagged_at`) is read live (`useProcessesLiveState`
 * - AGENTS.md section 24), not just from the one-time REST load `processes`
 * came from - otherwise a process flagged (or re-flagged) while this page
 * stayed open would never appear until a manual reload happened to catch it
 * at the right moment (a real bug, found live: cleared a process off the
 * Dashboard, reloaded, and it never came back even as the condition kept
 * recurring server-side). `liveEntry ? liveEntry.dashboardFlaggedAt : ...`,
 * not `??` - once a live snapshot has been seen for a process at all, its
 * `dashboardFlaggedAt` is authoritative even when that value is legitimately
 * `null` (not flagged), which `??` would incorrectly treat as "missing,
 * fall back to REST".
 */
const FILTERS = { search: true }

const DashboardTab = ({
  processes,
  search,
  onSearchChange,
  searchResetToken,
  pageSize,
  onPageSizeChange,
  expandedIds,
  setExpandedIds,
  onReload,
  onError,
  tabGroups,
  messageGroups,
  onGroupsChange,
  onResetFilters,
}) => {
  const live = useProcessesLiveState()
  const flagged = processes.filter((p) => {
    const liveEntry = live[p.id]
    return liveEntry ? liveEntry.dashboardFlaggedAt : p.dashboard_flagged_at
  })

  if (flagged.length === 0) {
    return (
      <CAlert color="success" className="text-center fs-3 fw-bold py-4">
        OK
      </CAlert>
    )
  }

  const handleRemove = async (process) => {
    try {
      await api.clearDashboardFlag(process.id)
      onReload()
    } catch (err) {
      onError(err.message)
    }
  }

  return (
    <ProcessesTable
      processes={flagged}
      filters={FILTERS}
      search={search}
      onSearchChange={onSearchChange}
      searchResetToken={searchResetToken}
      pageSize={pageSize}
      onPageSizeChange={onPageSizeChange}
      expandedIds={expandedIds}
      setExpandedIds={setExpandedIds}
      onReload={onReload}
      onError={onError}
      tabGroups={tabGroups}
      messageGroups={messageGroups}
      onGroupsChange={onGroupsChange}
      onResetFilters={onResetFilters}
      renderExtraRowAction={(process) => (
        <IconButton
          icon={cilX}
          size="sm"
          color="danger"
          center
          disabled={process.hasActiveWem}
          onClick={() => handleRemove(process)}
          ariaLabel="Remove from Dashboard"
        />
      )}
    />
  )
}

export default DashboardTab
