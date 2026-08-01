/**
 * Message Levels (AGENTS.md section 22, beep-count/repeat-seconds redesign
 * AGENTS_TO_DO.md 2026-08-01) - shared between MessageLevelsForm.jsx (the
 * row that owns a level's mode/beepCount/repeatSeconds) and the Heartbeat/
 * Data Logger edit modals' own "Level 1-4" pickers, which show what each
 * level actually sounds like instead of a bare number.
 */

// Off/Constant have no beep count; the eight beep entries are what the
// combined selector (one dropdown instead of separate mode + count
// controls) actually offers.
export const SELECTOR_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'constant', label: 'Constant' },
  ...[1, 2, 3, 4].map((count) => ({
    value: `shortBeep:${count}`,
    label: `${count} short beep${count > 1 ? 's' : ''}`,
  })),
  ...[1, 2, 3, 4].map((count) => ({
    value: `longBeep:${count}`,
    label: `${count} long beep${count > 1 ? 's' : ''}`,
  })),
]

// A message_levels row's `mode`/`beep_count` <-> the combined selector's
// single string value.
export function encodeSelectorValue(mode, beepCount) {
  return mode === 'shortBeep' || mode === 'longBeep' ? `${mode}:${beepCount}` : mode
}

export function decodeSelectorValue(value) {
  const [mode, count] = value.split(':')
  return { mode, beepCount: count ? Number(count) : null }
}

/**
 * "Warning 3 short beeps (repeatable)" / "Error - Constant" / "Warning -
 * Off". `repeatSeconds > 0` reads as "repeatable" (the whole burst plays
 * again after that many seconds, for as long as the condition stays
 * active); `0` reads as "once" (edge-triggered - plays once per
 * activation, then silent until the condition clears and re-triggers).
 */
export function formatMessageLevel({ type, mode, beepCount, repeatSeconds }) {
  const Type = type.charAt(0).toUpperCase() + type.slice(1)
  if (mode === 'off') return `${Type} - Off`
  if (mode === 'constant') return `${Type} - Constant`
  const style = mode === 'shortBeep' ? 'short' : 'long'
  const plural = beepCount === 1 ? 'beep' : 'beeps'
  const repeatWord = repeatSeconds > 0 ? 'repeatable' : 'once'
  return `${Type} ${beepCount} ${style} ${plural} (${repeatWord})`
}
