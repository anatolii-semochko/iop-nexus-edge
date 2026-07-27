import React, { useEffect, useState } from 'react'
import {
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CCardHeader,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { subscribeToLiveEvents } from '../../api/liveSocket'
import LiveBadge from '../devices/LiveBadge'

// Fixed cap on how many recent messages are kept on screen - temporary
// until a real filter/limit control is added (see to-do.txt).
const MAX_EVENTS = 200

const modeColor = (mode) => (mode === 'MANUAL' ? 'warning' : 'success')

let nextRowId = 0

/**
 * Raw feed of every message the shared WebSocket receives (apps/messaging-
 * gateway, AGENTS.md section 9) - unfiltered, newest first. A debugging/
 * visibility tool for the bus itself, distinct from the per-device overlays
 * on Device Detail / Dev Simulator. Lives in the Logs nav group (section
 * 29) alongside the Logs page - it moved out of Devices, its component
 * folder didn't (still imports LiveBadge from views/devices).
 */
const LiveEvents = () => {
  const [rows, setRows] = useState([])

  useEffect(
    () =>
      subscribeToLiveEvents(({ routingKey, event }) => {
        setRows((prev) => [{ id: nextRowId++, routingKey, event }, ...prev].slice(0, MAX_EVENTS))
      }),
    [],
  )

  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <div>
          <strong>Live Events</strong> <small>last {MAX_EVENTS}</small> <LiveBadge />
        </div>
        <CButton size="sm" color="secondary" variant="outline" onClick={() => setRows([])}>
          Clear
        </CButton>
      </CCardHeader>
      <CCardBody>
        {rows.length === 0 ? (
          <p className="text-body-secondary mb-0">No messages yet - waiting for live events...</p>
        ) : (
          <CTable hover responsive small>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Time</CTableHeaderCell>
                <CTableHeaderCell scope="col">Routing key</CTableHeaderCell>
                <CTableHeaderCell scope="col">Entity</CTableHeaderCell>
                <CTableHeaderCell scope="col">Resource</CTableHeaderCell>
                <CTableHeaderCell scope="col">Value</CTableHeaderCell>
                <CTableHeaderCell scope="col">Mode</CTableHeaderCell>
                <CTableHeaderCell scope="col">Source</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {rows.map((row) => (
                <CTableRow key={row.id}>
                  <CTableDataCell>
                    <code>{row.event.timestamp ?? '-'}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    <code>{row.routingKey}</code>
                  </CTableDataCell>
                  <CTableDataCell>
                    {row.event.domain}.{row.event.entityId}
                  </CTableDataCell>
                  <CTableDataCell>{row.event.resource ?? '-'}</CTableDataCell>
                  <CTableDataCell>
                    {row.event.value !== undefined ? String(row.event.value) : '-'}
                  </CTableDataCell>
                  <CTableDataCell>
                    {row.event.mode ? (
                      <CBadge color={modeColor(row.event.mode)}>{row.event.mode}</CBadge>
                    ) : (
                      '-'
                    )}
                  </CTableDataCell>
                  <CTableDataCell>{row.event.source ?? '-'}</CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default LiveEvents
