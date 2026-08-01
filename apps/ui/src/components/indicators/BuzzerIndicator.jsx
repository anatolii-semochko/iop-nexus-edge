import React from 'react'
import { INDICATOR_SIZE } from './constants'

const GRILLE_SIZE = INDICATOR_SIZE * 0.3
const GRILLE_COLOR = '#ced4da'

/**
 * Elementary buzzer light - looks like the round piezo buzzers on a
 * microcontroller board: a solid body (black idle, red active - the whole
 * body changes, not an inner fill like StatusIndicator's) with a small
 * fixed light-gray "grille" dot in the middle that never changes color,
 * purely decorative. Same footprint as every other indicator in this
 * folder. Not wired into any process view yet - built ahead of the
 * component that will use it.
 */
const BuzzerIndicator = ({ active }) => (
  <div
    style={{
      width: INDICATOR_SIZE,
      height: INDICATOR_SIZE,
      borderRadius: '50%',
      backgroundColor: active ? '#dc3545' : '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: GRILLE_SIZE,
        height: GRILLE_SIZE,
        borderRadius: '50%',
        backgroundColor: GRILLE_COLOR,
      }}
    />
  </div>
)

export default BuzzerIndicator
