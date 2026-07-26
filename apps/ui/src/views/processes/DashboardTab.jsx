import React from 'react'
import { CAlert } from '@coreui/react'
import { cilX } from '@coreui/icons'
import { api } from '../../api/client'
import IconButton from '../../components/IconButton'
import ProcessesTable from './ProcessesTable'

/**
 * Dashboard tab (AGENTS.md section 22) - every process that has *ever* had
 * an active WEM entry since last cleared, regardless of whether it's still
 * active right now. A process lands here the instant it gets its first
 * active entry (apps/api's processMessages.maybeFlagForDashboard) and
 * stays - the remove X only becomes clickable once it's genuinely back to
 * zero active entries (`process.hasActiveWem === false`), enforced
 * server-side too (DELETE .../dashboard-flag 400s otherwise).
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
  const flagged = processes.filter((p) => p.dashboard_flagged_at)

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
