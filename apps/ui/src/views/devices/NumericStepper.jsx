import React from 'react'
import { CButton, CFormInput } from '@coreui/react'

const format = (n) => Number(n).toFixed(2)

/**
 * +/- stepper for Float resources (e.g. Temperature) in the Dev Simulator
 * override column. The input is a disabled, read-only display of the
 * current value - only the +/- buttons are interactive, and each click
 * commits immediately (same instant-write philosophy as the Bool checkbox
 * and device-type sliders elsewhere in DevSimulator.jsx).
 *
 * Previously this had a free-text input with an explicit "Set" button,
 * gated on the text matching an exact "111.11" (signed, two-decimal-place)
 * pattern - typing e.g. "25" left Set silently disabled until a user
 * added ".00", which looked indistinguishable from "Set doesn't work".
 * Removing free-text editing entirely removes that trap.
 */
const NumericStepper = ({ value, step = 1, disabled = false, busy = false, onCommit }) => {
  const current = Number(value ?? 0)

  return (
    <div className="d-flex align-items-center gap-1">
      <CButton
        size="sm"
        variant="outline"
        color="secondary"
        disabled={disabled || busy}
        onClick={() => onCommit(Number(format(current - step)))}
      >
        -
      </CButton>
      <CFormInput size="sm" style={{ width: '6rem' }} value={format(current)} disabled readOnly />
      <CButton
        size="sm"
        variant="outline"
        color="secondary"
        disabled={disabled || busy}
        onClick={() => onCommit(Number(format(current + step)))}
      >
        +
      </CButton>
    </div>
  )
}

export default NumericStepper
