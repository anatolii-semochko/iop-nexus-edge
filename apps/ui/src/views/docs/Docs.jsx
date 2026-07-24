import React from 'react'
import { CCard, CCardBody, CCardHeader } from '@coreui/react'

/**
 * Local placeholder (AGENTS.md section 15 - CoreUI demo cleanup). Replaces
 * the template's sidebar "Docs" link, which pointed out to CoreUI's own
 * documentation site - this platform's actual docs live in the repo
 * (README.md, AGENTS.md, docs/PROJECT_MASTER-1.1.md), not behind a UI page,
 * so this stays empty until there's a real reason to render docs in-app.
 */
const Docs = () => {
  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Docs</strong>
      </CCardHeader>
      <CCardBody>Nothing here yet.</CCardBody>
    </CCard>
  )
}

export default Docs
