import React, { useEffect, useRef, useState } from 'react'
import { CButton, CFormInput } from '@coreui/react'

const format = (n) => Number(n).toFixed(2)

// Standard press-and-hold spinner behavior: a quick click steps once: hold
// past HOLD_DELAY_MS and it starts stepping by itself every
// REPEAT_INTERVAL_MS until released.
const HOLD_DELAY_MS = 1000
const REPEAT_INTERVAL_MS = 50

/**
 * +/- stepper for Float resources (e.g. Temperature) in the Dev Simulator
 * override column. By default the input is a disabled, read-only display
 * of the current value - only the +/- buttons are interactive, and each
 * click commits immediately (same instant-write philosophy as the Bool
 * checkbox and device-type sliders elsewhere in DevSimulator.jsx).
 *
 * Previously this had a free-text input with an explicit "Set" button,
 * gated on the text matching an exact "111.11" (signed, two-decimal-place)
 * pattern - typing e.g. "25" left Set silently disabled until a user
 * added ".00", which looked indistinguishable from "Set doesn't work".
 * Removing free-text editing entirely removes that trap.
 *
 * `editable` (AGENTS_TO_DO.md, 2026-08-23 - DevicesList.jsx's own
 * simulated-value editor in the expand row) opts back into a typable
 * input for that one caller specifically - the "Set"-button trap above
 * doesn't apply here since there's no separate confirm step to get stuck
 * on: typing then blurring (or Enter) commits directly, same instant-
 * write philosophy as the buttons, just via keyboard instead of a click.
 * Every other caller leaves this at its default `false` and is
 * unaffected.
 */
const NumericStepper = ({
  value,
  step = 1,
  min = -Infinity,
  max = Infinity,
  disabled = false,
  busy = false,
  editable = false,
  onCommit,
}) => {
  const current = Number(value ?? 0)
  // Mirrors `current` whenever it changes from outside (a fresh `value`
  // prop, i.e. not this input's own edit) - set directly during render
  // (React's own documented pattern for "adjust state when a prop
  // changes": https://react.dev/learn/you-might-not-need-an-effect),
  // not inside a `useEffect`, which this codebase's stricter React
  // Compiler-era lint rules reject for a plain setState call like this
  // one (same rule already noted elsewhere in this codebase - see e.g.
  // ProcessSettingsModal.jsx's own comments on the same class of rule).
  const [text, setText] = useState(() => format(current))
  const [syncedCurrent, setSyncedCurrent] = useState(current)
  if (current !== syncedCurrent) {
    setSyncedCurrent(current)
    setText(format(current))
  }

  // The value a held-down repeat continues from - can't read the `value`
  // prop for this: it only catches up once each onCommit's round trip
  // resolves and the parent re-renders, which is slower than the repeat
  // interval, so a fast hold would otherwise commit the same +1 over and
  // over instead of climbing.
  const runningValueRef = useRef(current)
  useEffect(() => {
    runningValueRef.current = current
  }, [current])

  const holdTimeoutRef = useRef(null)
  const repeatIntervalRef = useRef(null)
  // Set the instant a hold's first auto-step fires, so the browser's own
  // click event (which still follows mouseup) doesn't double-step - a
  // plain quick click never sets this, so it steps normally via onClick.
  const didAutoRepeatRef = useRef(false)

  // A running `setInterval` closes over `disabled`/`busy` as they were at
  // the moment the hold started - refs keep it seeing the current value on
  // every tick instead, so a DevSimulator-style `busy` flag flipping true
  // mid-hold (e.g. a slow commit still in flight) actually stops the
  // repeat rather than piling up overlapping requests regardless of it.
  const disabledRef = useRef(disabled)
  const busyRef = useRef(busy)
  useEffect(() => {
    disabledRef.current = disabled
    busyRef.current = busy
  }, [disabled, busy])

  const stopHold = () => {
    clearTimeout(holdTimeoutRef.current)
    clearInterval(repeatIntervalRef.current)
    holdTimeoutRef.current = null
    repeatIntervalRef.current = null
  }
  useEffect(() => stopHold, [])

  // Safety net: a real drag can easily release the pointer past the
  // button's edge, and onPointerUp/onPointerLeave alone would then never
  // fire, leaving the repeat running forever. A window-level listener
  // catches release anywhere on the page - harmless no-op when no hold is
  // active, since stopHold clears possibly-null timers either way.
  useEffect(() => {
    window.addEventListener('pointerup', stopHold)
    window.addEventListener('pointercancel', stopHold)
    return () => {
      window.removeEventListener('pointerup', stopHold)
      window.removeEventListener('pointercancel', stopHold)
    }
  }, [])

  // Returns whether the value actually moved - lets a held repeat stop
  // itself at the min/max clamp instead of continuing to fire identical
  // commits every tick for as long as the button stays held.
  const doStep = (direction) => {
    const stepped = runningValueRef.current + direction * step
    const clamped = Number(format(Math.min(max, Math.max(min, stepped))))
    if (clamped === runningValueRef.current) return false
    runningValueRef.current = clamped
    onCommit(clamped)
    return true
  }

  // `editable`-only (see this component's own doc comment) - commits
  // whatever is currently typed, same instant-write philosophy as
  // doStep above, just from the input's blur/Enter instead of a button.
  // No `runningValueRef` write needed here unlike doStep's own: that ref
  // only matters for a held-down repeat's own running baseline, and the
  // existing `current` effect above already re-syncs it once the parent
  // re-renders with the new `value` this commit produces.
  const commitText = () => {
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) {
      setText(format(current))
      return
    }
    const clamped = Number(format(Math.min(max, Math.max(min, parsed))))
    setText(format(clamped))
    if (clamped !== current) onCommit(clamped)
  }

  const startHold = (direction) => {
    if (disabled || busy) return
    // Clears any still-running hold before starting a new one - belt and
    // braces alongside the window listener above, so an interval can never
    // be orphaned by a fresh pointerdown overwriting its ref.
    stopHold()
    didAutoRepeatRef.current = false
    holdTimeoutRef.current = setTimeout(() => {
      didAutoRepeatRef.current = true
      doStep(direction)
      repeatIntervalRef.current = setInterval(() => {
        if (disabledRef.current || busyRef.current || !doStep(direction)) {
          stopHold()
        }
      }, REPEAT_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  const handleClick = (direction) => {
    if (didAutoRepeatRef.current) {
      // Already stepped at least once during the hold - this trailing
      // click is just the browser's normal click-on-release, not a new step.
      didAutoRepeatRef.current = false
      return
    }
    doStep(direction)
  }

  return (
    <div className="d-flex align-items-center gap-1">
      <CButton
        size="sm"
        variant="outline"
        color="secondary"
        disabled={disabled || busy}
        onPointerDown={() => startHold(-1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onClick={() => handleClick(-1)}
      >
        -
      </CButton>
      <CFormInput
        size="sm"
        style={{ width: '4rem' }}
        value={editable ? text : format(current)}
        disabled={disabled || !editable}
        readOnly={!editable}
        onChange={editable ? (e) => setText(e.target.value) : undefined}
        onBlur={editable ? commitText : undefined}
        onKeyDown={
          editable
            ? (e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }
            : undefined
        }
      />
      <CButton
        size="sm"
        variant="outline"
        color="secondary"
        disabled={disabled || busy}
        onPointerDown={() => startHold(1)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onClick={() => handleClick(1)}
      >
        +
      </CButton>
    </div>
  )
}

export default NumericStepper
