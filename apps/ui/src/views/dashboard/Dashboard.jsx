import React from 'react'
import { CCard, CCardBody, CCardHeader } from '@coreui/react'

/**
 * Empty placeholder (AGENTS.md section 15 - CoreUI demo cleanup). The
 * template's original Dashboard was entirely fake traffic/sales/social
 * widgets with no relation to this platform - deliberately left blank
 * rather than replaced with a real one, since there's no cross-cutting
 * "system overview" concept designed yet (see Devices/Orchestration pages
 * for what actually exists today).
 */
const Dashboard = () => {
  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Dashboard</strong>
      </CCardHeader>
      <CCardBody>Nothing here yet.</CCardBody>
    </CCard>
  )
}

export default Dashboard
