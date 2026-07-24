import React from 'react'
import { CButton } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilChevronBottom, cilChevronTop } from '@coreui/icons'

// Fixed square size so the column this sits in never resizes when a row
// toggles - same "jumping table" problem ACTION_BUTTON_STYLE fixes for
// action buttons elsewhere (ProcessesList.jsx).
const BUTTON_STYLE = { width: '2.25rem', height: '2.25rem' }

/**
 * Row-expand toggle, styled like the outline action buttons next to it
 * (`color="secondary" variant="outline"`) instead of the underlined
 * `color="link"` button it replaces. Generic - any expandable-row table can
 * use this, not just Processes. Flex-centered (not just relying on the
 * button's own line-height) - a bare CIcon's inline baseline otherwise sits
 * visibly above center inside a square button.
 */
const ExpandToggleButton = ({ expanded, onClick, size = 'sm' }) => (
  <CButton
    size={size}
    color="secondary"
    variant="outline"
    className="d-flex align-items-center justify-content-center p-0"
    style={BUTTON_STYLE}
    onClick={onClick}
    aria-label={expanded ? 'Collapse' : 'Expand'}
  >
    <CIcon icon={expanded ? cilChevronTop : cilChevronBottom} />
  </CButton>
)

export default ExpandToggleButton
