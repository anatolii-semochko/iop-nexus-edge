import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { api } from '../../api/client'

const healthColor = (health) => {
  switch (health) {
    case 'ok':
      return 'success'
    case 'unknown':
      return 'secondary'
    default:
      return 'warning'
  }
}

const NodesList = () => {
  const [nodes, setNodes] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .listNodes()
      .then(setNodes)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Nodes</strong>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {!error && !nodes && <CSpinner color="primary" />}
        {!error && nodes && nodes.length === 0 && (
          <CAlert color="info">No nodes registered yet.</CAlert>
        )}
        {!error && nodes && nodes.length > 0 && (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                <CTableHeaderCell scope="col">Type</CTableHeaderCell>
                <CTableHeaderCell scope="col">Location</CTableHeaderCell>
                <CTableHeaderCell scope="col">Health</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {nodes.map((node) => (
                <CTableRow key={node.id}>
                  <CTableDataCell>{node.name}</CTableDataCell>
                  <CTableDataCell>{node.type}</CTableDataCell>
                  <CTableDataCell>{node.location ?? '-'}</CTableDataCell>
                  <CTableDataCell>
                    <CBadge color={healthColor(node.health)}>{node.health}</CBadge>
                  </CTableDataCell>
                </CTableRow>
              ))}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>
    </CCard>
  )
}

export default NodesList
