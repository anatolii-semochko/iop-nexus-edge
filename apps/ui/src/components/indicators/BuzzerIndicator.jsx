import React from 'react'
import { INDICATOR_SIZE } from './constants'

const GRILLE_COLOR = '#ced4da'

/**
 * Elementary buzzer light - looks like the round piezo buzzers on a
 * microcontroller board: a solid body (black idle, red active - the whole
 * body changes, not an inner fill like StatusIndicator's) with a small
 * fixed light-gray "grille" dot in the middle that never changes color,
 * purely decorative. Same footprint as every other indicator in this
 * folder - used by ActiveBuzzerPanel.jsx (full size) and
 * AnnunciatorPanel.jsx (`size` = MINI_INDICATOR_SIZE, constants.js).
 */
const BuzzerIndicator = ({ active, size = INDICATOR_SIZE }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: active ? '#dc3545' : '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <div
      style={{
        width: size * 0.3,
        height: size * 0.3,
        borderRadius: '50%',
        backgroundColor: GRILLE_COLOR,
      }}
    />
  </div>
)

export default BuzzerIndicator
