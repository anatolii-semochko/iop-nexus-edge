import React from 'react'
import { CButton } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilFilterX } from '@coreui/icons'

// Same footprint as IconButton.jsx's own icon buttons, deliberately not
// built on top of IconButton itself - IconButton's `variant` prop defaults
// to `'outline'`, and a caller passing `variant={undefined}` to try to get
// the solid look doesn't actually override that (JS's own default-
// parameter semantics kick in for an explicitly-undefined value the same
// as an omitted one) - this button was rendering as a white/yellow-outline
// button that only turned solid yellow on hover, not solid yellow always,
// because of exactly that. Own small component instead, with `variant`
// simply never passed to CButton at all (CoreUI's own default there is
// solid).
const BUTTON_STYLE = { width: '2.25rem' }

/**
 * The one reset-filters control shared by every filter row in this app
 * (AGENTS.md section 26) - previously duplicated inline per view. Always
 * solid warning-yellow (not just on hover), right-aligned by the caller's
 * own layout (this component owns no positioning), height-matched to
 * sibling `size="sm"` `CFormSelect`/search inputs the same way IconButton
 * is - `align-middle` on the icon, not a flex-centered button (flexing
 * the button shrinks its auto-height below the line-height-driven size
 * every other `size="sm"` control in the row uses).
 */
const ResetFiltersButton = ({ active, onClick }) => {
  if (!active) return null
  return (
    <CButton
      size="sm"
      color="warning"
      style={BUTTON_STYLE}
      onClick={onClick}
      aria-label="Reset filters"
    >
      <CIcon icon={cilFilterX} className="align-middle" />
    </CButton>
  )
}

export default ResetFiltersButton
