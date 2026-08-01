import React from 'react'
import { CCol, CFormInput } from '@coreui/react'

/**
 * From/To datetime-range filter - two native <input type="datetime-local">
 * fields (AGENTS.md section 29, Logs page). No date-range picker library
 * exists in this app yet, and this project's own low-footprint philosophy
 * (Raspberry Pi target) argues against adding one just for this - native
 * inputs need no new dependency, at the cost of no calendar popup/presets.
 * Values are local-time strings straight from the input
 * (`utils/format.js`'s `localDateTimeToIso` converts them for the API).
 */
const DateRangeFilter = ({ from, to, onFromChange, onToChange }) => (
  <>
    <CCol xs="auto">
      <CFormInput
        type="datetime-local"
        size="sm"
        style={{ width: '13em' }}
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        aria-label="From"
      />
    </CCol>
    <CCol xs="auto">
      <CFormInput
        type="datetime-local"
        size="sm"
        style={{ width: '13em' }}
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        aria-label="To"
      />
    </CCol>
  </>
)

export default DateRangeFilter
