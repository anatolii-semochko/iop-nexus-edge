import React from 'react'
import { CBadge } from '@coreui/react'

/**
 * Row-level status label (AGENTS_TO_DO.md, 2026-08-15 background-color
 * rule, applied to Devices/Nodes/Processes tables): error -> danger,
 * warning -> warning, simulation -> info. Takes the SAME `rowColor`
 * value each table already computes for its own `<CTableRow color=...>`
 * background, rather than a second parallel condition - guarantees the
 * label and the row tint can never drift out of sync, by construction.
 *
 * One deliberate divergence: the row background for "simulation" is
 * `info`, but this label reads `primary` instead - confirmed with the
 * user (2026-08-15) as an intentional accent/background split, not an
 * oversight.
 */
const LABELS = {
  danger: { text: 'Error', color: 'danger' },
  warning: { text: 'Warning', color: 'warning' },
  info: { text: 'Simulation', color: 'primary' },
}

const RowStatusBadge = ({ rowColor }) => {
  const { text, color } = LABELS[rowColor] ?? { text: 'OK', color: 'success' }
  return <CBadge color={color} className='mb-1'>{text}</CBadge>
}

export default RowStatusBadge
