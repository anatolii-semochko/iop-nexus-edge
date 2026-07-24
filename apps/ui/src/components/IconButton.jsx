import React from 'react'
import { CButton } from '@coreui/react'
import CIcon from '@coreui/icons-react'

// Fixed width only - never a fixed height. A `size="sm"` CButton and a
// `size="sm"` CFormInput/CFormSelect are already the same height by
// Bootstrap's own design (shared $input-btn-padding-y-sm variable); forcing
// a height here (2.25rem) fought that and made these buttons visibly
// taller than the filter row's inputs sitting right next to them. Flex
// centering is still needed regardless of height - a bare CIcon's inline
// baseline otherwise sits visibly above center inside a button (first
// found on ExpandToggleButton, AGENTS.md section 17).
const BUTTON_STYLE = { width: '2.25rem' }

const IconButton = ({
  icon,
  color = 'secondary',
  variant = 'outline',
  size = 'md',
  onClick,
  ariaLabel,
  disabled,
}) => (
  <CButton
    size={size}
    color={color}
    variant={variant}
    disabled={disabled}
    className="d-flex align-items-center justify-content-center"
    style={BUTTON_STYLE}
    onClick={onClick}
    aria-label={ariaLabel}
  >
    <CIcon icon={icon} />
  </CButton>
)

export default IconButton
