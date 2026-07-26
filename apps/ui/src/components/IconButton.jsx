import React from 'react'
import { CButton } from '@coreui/react'
import CIcon from '@coreui/icons-react'

// Fixed width only - never a fixed height. A `size="sm"` CButton and a
// `size="sm"` CFormInput/CFormSelect are already the same height by
// Bootstrap's own design (shared $input-btn-padding-y-sm variable), but
// only as long as the button's own height stays line-height-driven. A
// bare CIcon's inline baseline sits visibly above center inside a button
// (first found on ExpandToggleButton, AGENTS.md section 17) - the earlier
// fix wrapped the button's content in `d-flex align-items-center
// justify-content-center` to recenter it, but that turns the button into
// a flex container, whose auto height then comes from the icon's own
// ~16px content box instead of the font-size/line-height math every
// text-labelled button and form control uses - shorter than its
// siblings. `align-middle` (`vertical-align: middle`) fixes the same
// baseline offset on the icon itself, leaving the button un-flexed so its
// height still comes from line-height like everything next to it.
const BUTTON_STYLE = { width: '2.25rem' }

const IconButton = ({
  icon,
  color = 'secondary',
  variant = 'outline',
  size = 'md',
  onClick,
  ariaLabel,
  disabled,
  center,
}) => (
  <CButton
    size={size}
    color={color}
    variant={variant}
    disabled={disabled}
    style={BUTTON_STYLE}
    onClick={onClick}
    aria-label={ariaLabel}
  >
    <CIcon icon={icon} className={center ? 'align-middle' : undefined} />
  </CButton>
)

export default IconButton
