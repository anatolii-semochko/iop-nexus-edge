import React, { useEffect, useState } from 'react'
import { CFormInput } from '@coreui/react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

/**
 * Debounced text-search box for tables. Keeps the raw keystroke value in its
 * own local state (so the input never lags behind typing) and only calls
 * `onSearch` with the debounced value - one line to wire into any list view's
 * filter predicate, no page-local useEffect/setTimeout pair required
 * (AGENTS.md section 12; sevenstime-backoffice reimplemented this inline in
 * every view instead of factoring it out).
 */
const TableSearchInput = ({ value = '', onSearch, placeholder = 'Search...', delayMs = 300 }) => {
  const [text, setText] = useState(value)
  const debounced = useDebouncedValue(text, delayMs)

  useEffect(() => {
    onSearch(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return (
    <CFormInput
      size="sm"
      style={{ width: '16rem' }}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  )
}

export default TableSearchInput
