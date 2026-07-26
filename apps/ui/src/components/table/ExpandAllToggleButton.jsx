import React from 'react'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import ExpandToggleButton from './ExpandToggleButton'

/**
 * The table-header counterpart to a row's own ExpandToggleButton - expands
 * or collapses every currently-visible expandable row at once. One-line
 * drop-in for any table already using useExpandableRows: pass the id list
 * of *this page's* expandable rows plus the same expandedIds/setExpandedIds
 * the rows themselves use. Renders nothing if there's nothing to expand.
 */
const ExpandAllToggleButton = ({ ids, expandedIds, setExpandedIds }) => {
  const { allExpanded, toggleAll } = useExpandableRows(expandedIds, setExpandedIds)
  if (ids.length === 0) return null
  return <ExpandToggleButton expanded={allExpanded(ids)} onClick={() => toggleAll(ids)} />
}

export default ExpandAllToggleButton
