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
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'
import { formatRelativeTime } from '../../utils/format'

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

const matchesSearch = (node, search) => {
  if (!search) return true
  const needle = search.toLowerCase()
  return [node.name, node.type, node.location].some((field) =>
    field?.toLowerCase().includes(needle),
  )
}

const NodesList = () => {
  const [nodes, setNodes] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    api
      .listNodes()
      .then(setNodes)
      .catch((err) => setError(err.message))
  }, [])

  const filtered = (nodes ?? []).filter((node) => matchesSearch(node, search))
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered)

  return (
    <CCard className="mb-4">
      <CCardHeader>
        <strong>Nodes</strong>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {!error && !nodes && <CSpinner color="primary" />}
        {!error && nodes && (
          <>
            <div className="mb-3">
              <TableSearchInput
                value={search}
                onSearch={setSearch}
                placeholder="Search by name, type, location..."
              />
            </div>
            {filtered.length === 0 ? (
              <CAlert color="info">
                {nodes.length === 0 ? 'No nodes registered yet.' : 'No nodes match this search.'}
              </CAlert>
            ) : (
              <>
                <CTable hover responsive>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Type</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Location</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Health</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Last heartbeat</CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {pageItems.map((node) => (
                      <CTableRow key={node.id}>
                        <CTableDataCell>{node.name}</CTableDataCell>
                        <CTableDataCell>{node.type}</CTableDataCell>
                        <CTableDataCell>{node.location ?? '-'}</CTableDataCell>
                        <CTableDataCell>
                          <CBadge color={healthColor(node.health)}>{node.health}</CBadge>
                        </CTableDataCell>
                        <CTableDataCell>
                          {formatRelativeTime(node.last_heartbeat_at)}
                        </CTableDataCell>
                      </CTableRow>
                    ))}
                  </CTableBody>
                </CTable>
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  totalItems={totalItems}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </>
            )}
          </>
        )}
      </CCardBody>
    </CCard>
  )
}

export default NodesList
