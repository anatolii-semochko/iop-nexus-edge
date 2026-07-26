import React from 'react'

const WIDTH = 56
const HEIGHT = 28
const KNOB_MARGIN = 3
const KNOB_SIZE = HEIGHT - KNOB_MARGIN * 2

/**
 * Universal large left-right toggle (AGENTS.md section 10/26) - a plain
 * `<button role="switch">`, not CoreUI's `CFormSwitch` (Bootstrap's own
 * switch styling is thin/small and not straightforward to recolor per
 * instance - this needs to be both bigger and take its own colors).
 * `activeColor`/`inactiveColor` are params, not a fixed palette, so any
 * caller can theme it - default green/light-gray is just this component's
 * own default, not a hardcoded assumption about what "on" means elsewhere.
 */
const Switch = ({
  checked,
  onChange,
  disabled = false,
  activeColor = '#198754',
  inactiveColor = '#d3d3d3',
  ariaLabel,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="p-0 border-0"
    style={{
      width: WIDTH,
      height: HEIGHT,
      borderRadius: HEIGHT / 2,
      backgroundColor: checked ? activeColor : inactiveColor,
      position: 'relative',
      transition: 'background-color 0.15s ease',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      flexShrink: 0,
    }}
  >
    <span
      style={{
        position: 'absolute',
        top: KNOB_MARGIN,
        left: checked ? WIDTH - KNOB_SIZE - KNOB_MARGIN : KNOB_MARGIN,
        width: KNOB_SIZE,
        height: KNOB_SIZE,
        borderRadius: '50%',
        backgroundColor: '#fff',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
        transition: 'left 0.15s ease',
      }}
    />
  </button>
)

export default Switch
