import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormSelect,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import { cilSettings } from '@coreui/icons'
import { api } from '../../api/client'
import GroupsConfigModal from '../../components/GroupsConfigModal'
import IconButton from '../../components/IconButton'
import Switch from '../../components/Switch'
import ResetFiltersButton from '../../components/ResetFiltersButton'
import ExpandAllToggleButton from '../../components/table/ExpandAllToggleButton'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import { usePagination } from '../../hooks/usePagination'
import { usePersistedState } from '../../hooks/usePersistedState'
import RowStatusBadge from '../../components/table/RowStatusBadge'
import { formatRelativeTime } from '../../utils/format'
import NodeSettingsModal from './NodeSettingsModal'

// Registration for usePersistedState (AGENTS_TO_DO.md, 2026-08-01, joined
// 2026-08-02 by `expandedIds`) - flat variant (no tabs), unlike
// ProcessesList.jsx's `perTab` shape. `page` itself is deliberately not
// persisted (AGENTS.md section 17) - only `pageSize`, same convention as
// every other persisted page.
const PERSISTED_DEFAULTS = {
  search: '',
  groupFilter: '',
  pageSize: 10,
  expandedIds: [],
}

// Detail row (AGENTS_TO_DO.md, 2026-08-02) - raw node state as JSON for
// now ("Поки що показуємо стан ноди. Можеш показувати JSON. Потім будемо
// допрацьовувати") - already have the full row object from the list, no
// extra fetch needed.
const NodeDetailRow = ({ node }) => (
  <div className="p-3 pt-0">
    <pre className="mb-0 small">{JSON.stringify(node, null, 2)}</pre>
  </div>
)

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

/**
 * Nodes list (AGENTS_TO_DO.md, 2026-08-01) - now with a Node Group filter
 * and a page-level Config button (left of Clear Filters) that manages the
 * Node Group list itself, plus a per-row Settings popup that assigns
 * *this* node's single group. A Node is a physical workplace served
 * locally by exactly one group of Nodes - single assignment, unlike
 * Devices' many-to-many Device Groups (DevicesList.jsx).
 */
const NodesList = () => {
  const [nodes, setNodes] = useState(null)
  const [nodeGroups, setNodeGroups] = useState([])
  const [error, setError] = useState(null)
  const [pageState, setPageState] = usePersistedState('nexusedge.nodesPage', PERSISTED_DEFAULTS)
  const { search, groupFilter, expandedIds } = pageState
  const setSearch = (value) => setPageState({ search: value })
  const setGroupFilter = (value) => setPageState({ groupFilter: value })
  const setExpandedIds = (ids) => setPageState({ expandedIds: ids })
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)
  // Bumped on reset to force TableSearchInput to remount with a blank
  // value (AGENTS.md section 11/17) - it owns its own typing state after
  // mount, so a persisted `search` clear alone wouldn't clear what's
  // actually showing in the box. Not itself persisted - a remount trigger,
  // not meaningful state to restore.
  const [searchResetToken, setSearchResetToken] = useState(0)
  const [configVisible, setConfigVisible] = useState(false)
  const [settingsNode, setSettingsNode] = useState(null)

  const reloadNodes = () =>
    api
      .listNodes()
      .then(setNodes)
      .catch((err) => setError(err.message))
  const reloadNodeGroups = () =>
    api
      .listNodeGroups()
      .then(setNodeGroups)
      .catch((err) => setError(err.message))

  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - toggles
  // every device attached to this node's simulated redirect at once.
  // Plain refetch-after-write, same as every other row mutation on this
  // page (rename/group reassignment) - no optimistic update, this is a
  // low-frequency admin action, not a hot path.
  const handleToggleSimulated = (node) =>
    api
      .setNodeSimulated(node.id, !node.simulated)
      .then(reloadNodes)
      .catch((err) => setError(err.message))

  useEffect(() => {
    reloadNodes()
    reloadNodeGroups()
  }, [])

  const filtered = (nodes ?? [])
    .filter((node) => matchesSearch(node, search))
    .filter((node) => !groupFilter || String(node.group_id) === groupFilter)
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered, {
    pageSize: pageState.pageSize,
    onPageSizeChange: (size) => setPageState({ pageSize: size }),
  })

  const hasActiveFilters = Boolean(search) || Boolean(groupFilter)
  const handleResetFilters = () => {
    setPageState({ search: '', groupFilter: '' })
    setSearchResetToken((token) => token + 1)
  }

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
            <CRow className="mb-3 g-2 align-items-center">
              <CCol xs="auto">
                <CFormSelect
                  size="sm"
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                >
                  <option value="">All groups</option>
                  {nodeGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </CFormSelect>
              </CCol>
              <CCol xs="auto">
                <TableSearchInput
                  key={searchResetToken}
                  value={search}
                  onSearch={setSearch}
                  placeholder="Search by name, type, location..."
                />
              </CCol>
              <CCol className="d-flex justify-content-end gap-2">
                <IconButton
                  icon={cilSettings}
                  size="sm"
                  center
                  onClick={() => setConfigVisible(true)}
                  ariaLabel="Configure Node Groups"
                />
                <ResetFiltersButton active={hasActiveFilters} onClick={handleResetFilters} />
              </CCol>
            </CRow>
            {filtered.length === 0 ? (
              <CAlert color="info">
                {nodes.length === 0 ? 'No nodes registered yet.' : 'No nodes match these filters.'}
              </CAlert>
            ) : (
              <>
                <CTable responsive>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Health</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Name</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Type</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Location</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Group</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Last heartbeat</CTableHeaderCell>
                      <CTableHeaderCell scope="col" className="text-end">
                        <div className="d-flex justify-content-end align-items-center gap-2">
                          <span>Actions</span>
                          <ExpandAllToggleButton
                            ids={pageItems.map((node) => node.id)}
                            expandedIds={expandedIds}
                            setExpandedIds={setExpandedIds}
                          />
                        </div>
                      </CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {pageItems.map((node) => {
                      // Same `border-bottom-0` idiom ProcessesTable.jsx's own
                      // expanded row already uses (AGENTS_TO_DO.md, 2026-08-10
                      // "візуальна консистентність") - removes the line
                      // between a row and its own expansion, only while
                      // actually expanded.
                      const expandedRow = isExpanded(node.id)
                      const noBorderWhenExpanded = expandedRow ? 'border-bottom-0' : undefined
                      // Background-color rule (AGENTS_TO_DO.md, 2026-08-15,
                      // same as DevicesList.jsx's own): error -> danger,
                      // simulation -> info. `'unknown'` health is
                      // deliberately NOT treated as an error - it means
                      // "not determined yet", not "confirmed bad", so a
                      // freshly-registered node doesn't show up red before
                      // anything has actually gone wrong.
                      const isError =
                        node.health && node.health !== 'ok' && node.health !== 'unknown'
                      const rowColor = isError ? 'danger' : node.simulated ? 'info' : undefined
                      return (
                        <React.Fragment key={node.id}>
                          <CTableRow color={rowColor}>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              <RowStatusBadge rowColor={rowColor} />
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              <CBadge color={healthColor(node.health)}>{node.health}</CBadge>
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              {node.name}
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              {node.type}
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              {node.location ?? '-'}
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              {node.group_name ?? '-'}
                            </CTableDataCell>
                            <CTableDataCell className={noBorderWhenExpanded}>
                              {formatRelativeTime(node.last_heartbeat_at)}
                            </CTableDataCell>
                            <CTableDataCell className={`text-end ${noBorderWhenExpanded ?? ''}`}>
                              <div className="d-flex justify-content-end align-items-center gap-1 flex-nowrap">
                                <IconButton
                                  icon={cilSettings}
                                  size="sm"
                                  center
                                  onClick={() => setSettingsNode(node)}
                                  ariaLabel={`${node.name} settings`}
                                />
                                <Switch
                                  checked={node.simulated}
                                  onChange={() => handleToggleSimulated(node)}
                                  disabled={!node.simulated && !node.has_simulated_twin}
                                  activeColor="#e55353"
                                  inactiveColor="#d3d3d3"
                                  ariaLabel={
                                    node.simulated
                                      ? `${node.name} is simulated - switch to physical`
                                      : node.has_simulated_twin
                                        ? `${node.name} is physical - switch to simulated`
                                        : `${node.name} has no simulated twin provisioned`
                                  }
                                />
                                <ExpandToggleButton
                                  expanded={isExpanded(node.id)}
                                  onClick={() => toggleOne(node.id)}
                                />
                              </div>
                            </CTableDataCell>
                          </CTableRow>
                          {expandedRow && (
                            <CTableRow color={rowColor}>
                              <CTableDataCell colSpan={8} className="p-0">
                                <NodeDetailRow node={node} />
                              </CTableDataCell>
                            </CTableRow>
                          )}
                        </React.Fragment>
                      )
                    })}
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
      <GroupsConfigModal
        visible={configVisible}
        onClose={() => setConfigVisible(false)}
        title="Node Groups"
        addLabel="Add Group"
        namePlaceholder="Group name"
        items={nodeGroups}
        onAdd={async (name) => {
          await api.createNodeGroup(name)
          reloadNodeGroups()
        }}
        onRename={async (id, name) => {
          await api.renameNodeGroup(id, name)
          reloadNodeGroups()
          reloadNodes()
        }}
        onDelete={async (id) => {
          await api.deleteNodeGroup(id)
          reloadNodeGroups()
        }}
      />
      <NodeSettingsModal
        visible={Boolean(settingsNode)}
        onClose={() => setSettingsNode(null)}
        node={settingsNode}
        nodeGroups={nodeGroups}
        onSaved={reloadNodes}
      />
    </CCard>
  )
}

export default NodesList
