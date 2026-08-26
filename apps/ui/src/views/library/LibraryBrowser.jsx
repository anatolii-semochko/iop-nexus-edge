import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CButtonGroup,
  CCard,
  CCardBody,
  CCardHeader,
  CCol,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CFormTextarea,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
  CTable,
  CTableBody,
  CTableDataCell,
  CTableHead,
  CTableHeaderCell,
  CTableRow,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilLibrary, cilReload } from '@coreui/icons'
import { api } from '../../api/client'
import ExpandToggleButton from '../../components/table/ExpandToggleButton'
import TableSearchInput from '../../components/table/TableSearchInput'
import { useExpandableRows } from '../../hooks/useExpandableRows'
import upIcon from '../../assets/images/up.png'
import LibraryItemDetailRow from './LibraryItemDetailRow'

const KINDS = [
  { value: 'device', label: 'Devices' },
  { value: 'node', label: 'Nodes' },
  { value: 'process', label: 'Processes' },
]

// Process management (AGENTS_TO_DO.md, 2026-08-14) - a process-kind
// catalog item's own "Add process" action, only shown for kind ===
// 'process'. Config is a raw JSON textarea rather than a per-kind
// dynamic form - each kind's own docs/README.md (see devices/processes/
// example-threshold-monitor/docs/README.md) documents its own config
// shape; building a generic dynamic form for arbitrary jsonb config
// would be real extra work for something this rarely used.
const AddProcessModal = ({ item, visible, onClose, onCreated }) => {
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [type, setType] = useState('controllable')
  const [deviceId, setDeviceId] = useState('')
  const [configText, setConfigText] = useState('{}')
  const [groups, setGroups] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!visible) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(item?.name ?? '')

    setError(null)
    api
      .listProcessGroups()
      .then(setGroups)
      .catch((err) => setError(err.message))
  }, [visible, item])

  const handleSubmit = async () => {
    setError(null)
    let config
    try {
      config = configText.trim() ? JSON.parse(configText) : {}
    } catch {
      setError('Config must be valid JSON.')
      return
    }
    setBusy(true)
    try {
      await api.createProcess({
        name,
        groupId: Number(groupId),
        type,
        kind: item.typeName,
        deviceId: deviceId ? Number(deviceId) : null,
        config,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CModal visible={visible} onClose={onClose}>
      <CModalHeader>
        <CModalTitle>Add process - {item?.name}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        <div className="mb-3">
          <CFormLabel>Name</CFormLabel>
          <CFormInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <div className="mb-3">
          <CFormLabel>Group</CFormLabel>
          <CFormSelect value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy}>
            <option value="">Select a group...</option>
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </CFormSelect>
        </div>
        <div className="mb-3">
          <CFormLabel>Type</CFormLabel>
          <CFormSelect value={type} onChange={(e) => setType(e.target.value)} disabled={busy}>
            <option value="controllable">Controllable</option>
            <option value="permanent">Permanent</option>
          </CFormSelect>
        </div>
        <div className="mb-3">
          <CFormLabel>Device id (optional)</CFormLabel>
          <CFormInput
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="mb-3">
          <CFormLabel>Config (JSON - see this kind&apos;s own docs/README.md)</CFormLabel>
          <CFormTextarea
            rows={4}
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            disabled={busy}
          />
        </div>
        {item?.typeName && (
          <div className="text-body-secondary small">
            This creates a `processes` row with kind=&quot;{item.typeName}&quot;. If no plugin file
            for this kind is loaded in the running orchestrator yet (e.g. you haven&apos;t run `make
            add-process-kind` and restarted it), the new row will show as pending restart and
            won&apos;t tick until then.
          </div>
        )}
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </CButton>
        <CButton color="primary" onClick={handleSubmit} disabled={busy || !name || !groupId}>
          {busy ? <CSpinner size="sm" /> : 'Create'}
        </CButton>
      </CModalFooter>
    </CModal>
  )
}

// Breadcrumb strip (AGENTS_TO_DO.md, 2026-08-01 discussion) - modeled on
// sevenstime-backoffice's web-interface/src/views/base-elements/
// Categories.js: the up-arrow image (copied verbatim, same asset) plus a
// "Root / Cat1 / Cat2" clickable path. Unlike that reference, this is
// read-only navigation only - no add/edit/delete category forms, since
// the Library Catalog's categories are managed by moving folders in git,
// not through this UI.
const Breadcrumb = ({ trail, onNavigate }) => (
  <div className="mb-2 d-flex align-items-center">
    <img
      src={upIcon}
      alt="Up"
      onClick={trail.length ? () => onNavigate(trail[trail.length - 2]?.id ?? null) : undefined}
      style={{
        opacity: trail.length ? 1 : 0.4,
        cursor: trail.length ? 'pointer' : 'default',
        width: 20,
        height: 20,
      }}
    />
    <div className="ms-2">
      <a
        href="#"
        className={trail.length ? 'link-primary' : ''}
        onClick={(e) => {
          e.preventDefault()
          onNavigate(null)
        }}
      >
        Root
      </a>
      {trail.map((crumb, i) => (
        <span key={crumb.id}>
          {' / '}
          {i === trail.length - 1 ? (
            <span>{crumb.name}</span>
          ) : (
            <a
              href="#"
              className="link-primary"
              onClick={(e) => {
                e.preventDefault()
                onNavigate(crumb.id)
              }}
            >
              {crumb.name}
            </a>
          )}
        </span>
      ))}
    </div>
  </div>
)

const iconUrl = (iconPath) => (iconPath ? `/api${iconPath}` : null)

const RowIcon = ({ iconPath }) => {
  const url = iconUrl(iconPath)
  if (!url) return <CIcon icon={cilLibrary} className="text-body-secondary" />
  return <img src={url} alt="" style={{ width: 24, height: 24, objectFit: 'contain' }} />
}

/**
 * Library Catalog browser (AGENTS.md section 32) - a read-only index over
 * devices/'s design-time layout, kept in sync from disk by
 * apps/api/src/libraryCatalog.ts. Devices and Nodes are two independent
 * trees (a Device no longer lives inside a Node's own folder, section
 * 7's 2026-08-01 correction), switched via the button group below - each
 * with its own breadcrumb-driven browse state.
 */
const LibraryBrowser = () => {
  const [kind, setKind] = useState('device')
  const [categoryId, setCategoryId] = useState(null)
  const [breadcrumb, setBreadcrumb] = useState([])
  const [children, setChildren] = useState(null)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState(null)
  const [addProcessItem, setAddProcessItem] = useState(null)
  const [createdMessage, setCreatedMessage] = useState(null)
  const [expandedIds, setExpandedIds] = useState([])
  const { isExpanded, toggleOne } = useExpandableRows(expandedIds, setExpandedIds)

  const loadBrowse = (nextKind, nextCategoryId) => {
    setError(null)
    api
      .browseLibrary(nextKind, nextCategoryId)
      .then((data) => {
        setBreadcrumb(data.breadcrumb)
        setChildren(data.children)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    // Fetching on kind/categoryId change, not deriving state from props -
    // same accepted pattern as ResourceMonitorPanel.jsx's own history
    // accumulation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBrowse(kind, categoryId)
  }, [kind, categoryId])

  useEffect(() => {
    if (!search) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults(null)
      return
    }
    const timeout = setTimeout(() => {
      api
        .searchLibrary(kind, search)
        .then(setSearchResults)
        .catch((err) => setError(err.message))
    }, 300)
    return () => clearTimeout(timeout)
  }, [kind, search])

  const handleKindChange = (nextKind) => {
    setKind(nextKind)
    setCategoryId(null)
    setSearch('')
    setExpandedIds([])
  }

  const handleNavigate = (nextCategoryId) => {
    setCategoryId(nextCategoryId)
    setExpandedIds([])
  }

  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result = await api.syncLibrary()
      setSyncMessage(`Synced: ${result.categories} categories, ${result.items} items.`)
      loadBrowse(kind, categoryId)
    } catch (err) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const showingSearch = Boolean(search)
  const rows = showingSearch ? searchResults : children

  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <strong>Library</strong>
        <CButton
          color="secondary"
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <CIcon icon={cilReload} className="me-1" />
          {syncing ? 'Syncing...' : 'Sync'}
        </CButton>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {syncMessage && (
          <CAlert color="success" dismissible onClose={() => setSyncMessage(null)}>
            {syncMessage}
          </CAlert>
        )}

        <CRow className="mb-3 g-2 align-items-center">
          <CCol xs="auto">
            <CButtonGroup size="sm">
              {KINDS.map((k) => (
                <CButton
                  key={k.value}
                  color="primary"
                  variant={kind === k.value ? undefined : 'outline'}
                  onClick={() => handleKindChange(k.value)}
                >
                  {k.label}
                </CButton>
              ))}
            </CButtonGroup>
          </CCol>
          <CCol xs="auto">
            <TableSearchInput
              value={search}
              onSearch={setSearch}
              placeholder={`Search ${kind === 'device' ? 'devices' : kind === 'node' ? 'nodes' : 'processes'} by name or description...`}
            />
          </CCol>
        </CRow>

        {!showingSearch && <Breadcrumb trail={breadcrumb} onNavigate={handleNavigate} />}

        {!rows ? (
          <CSpinner size="sm" />
        ) : rows.length === 0 ? (
          <CAlert color="info">{showingSearch ? 'No matches.' : 'Nothing here yet.'}</CAlert>
        ) : (
          <CTable hover responsive>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell style={{ width: 40 }}></CTableHeaderCell>
                <CTableHeaderCell>Name</CTableHeaderCell>
                <CTableHeaderCell>Description</CTableHeaderCell>
                <CTableHeaderCell>Used in project</CTableHeaderCell>
                {kind === 'process' && <CTableHeaderCell></CTableHeaderCell>}
                <CTableHeaderCell style={{ width: 40 }}></CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {rows.map((row) => {
                const expandedRow = row.type === 'item' && isExpanded(row.id)
                const columnCount = kind === 'process' ? 6 : 5
                return (
                  <React.Fragment key={`${row.type ?? 'item'}:${row.id}`}>
                    <CTableRow className={expandedRow ? 'border-bottom-0' : undefined}>
                      <CTableDataCell>
                        <RowIcon iconPath={row.iconPath} />
                      </CTableDataCell>
                      <CTableDataCell>
                        {row.type === 'category' ? (
                          <a
                            href="#"
                            className="link-primary"
                            onClick={(e) => {
                              e.preventDefault()
                              handleNavigate(row.id)
                            }}
                          >
                            {row.name}
                          </a>
                        ) : (
                          row.name
                        )}
                      </CTableDataCell>
                      <CTableDataCell>{row.description ?? '-'}</CTableDataCell>
                      <CTableDataCell>
                        {row.type === 'category' ? (
                          '-'
                        ) : row.usedInProject ? (
                          <CBadge color="success" className="mb-1">
                            Used
                          </CBadge>
                        ) : (
                          <CBadge color="secondary" className="mb-1">
                            Not used
                          </CBadge>
                        )}
                      </CTableDataCell>
                      {kind === 'process' && (
                        <CTableDataCell>
                          {row.type === 'item' && (
                            <CButton
                              size="sm"
                              color="primary"
                              variant="outline"
                              onClick={() => setAddProcessItem(row)}
                            >
                              Add process
                            </CButton>
                          )}
                        </CTableDataCell>
                      )}
                      <CTableDataCell>
                        {row.type === 'item' && (
                          <ExpandToggleButton
                            expanded={expandedRow}
                            onClick={() => toggleOne(row.id)}
                          />
                        )}
                      </CTableDataCell>
                    </CTableRow>
                    {expandedRow && (
                      <CTableRow>
                        <CTableDataCell colSpan={columnCount} className="p-0">
                          <LibraryItemDetailRow row={row} kind={kind} />
                        </CTableDataCell>
                      </CTableRow>
                    )}
                  </React.Fragment>
                )
              })}
            </CTableBody>
          </CTable>
        )}
      </CCardBody>

      <AddProcessModal
        item={addProcessItem}
        visible={Boolean(addProcessItem)}
        onClose={() => setAddProcessItem(null)}
        onCreated={() =>
          setCreatedMessage(`Process "${addProcessItem?.name}" created - see the Processes page.`)
        }
      />
      {createdMessage && (
        <CAlert
          color="success"
          dismissible
          onClose={() => setCreatedMessage(null)}
          className="m-3 mt-0"
        >
          {createdMessage}
        </CAlert>
      )}
    </CCard>
  )
}

export default LibraryBrowser
