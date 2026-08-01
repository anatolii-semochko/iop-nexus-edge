import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CBadge,
  CButton,
  CButtonGroup,
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
import CIcon from '@coreui/icons-react'
import { cilLibrary, cilReload } from '@coreui/icons'
import { api } from '../../api/client'
import TableSearchInput from '../../components/table/TableSearchInput'
import upIcon from '../../assets/images/up.png'

const KINDS = [
  { value: 'device', label: 'Devices' },
  { value: 'node', label: 'Nodes' },
]

// Breadcrumb strip (AGENTS_TO_DO.md, 2026-08-01 discussion) - modeled on
// sevenstime-backoffice's web-interface/src/views/base-elements/
// Categories.js: the up-arrow image (copied verbatim, same asset) plus a
// "Root / Cat1 / Cat2" clickable path. Unlike that reference, this is
// read-only navigation only - no add/edit/delete category forms, since
// the Library Catalog's categories are managed by moving folders in git,
// not through this UI.
const Breadcrumb = ({ trail, onNavigate }) => (
  <div className="mb-3 d-flex align-items-center">
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
  }

  const handleNavigate = (nextCategoryId) => {
    setCategoryId(nextCategoryId)
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
        <div className="d-flex align-items-center gap-2">
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
        </div>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {syncMessage && (
          <CAlert color="success" dismissible onClose={() => setSyncMessage(null)}>
            {syncMessage}
          </CAlert>
        )}

        <div className="mb-3">
          <TableSearchInput
            value={search}
            onSearch={setSearch}
            placeholder={`Search ${kind === 'device' ? 'devices' : 'nodes'} by name or description...`}
          />
        </div>

        {!showingSearch && <Breadcrumb trail={breadcrumb} onNavigate={handleNavigate} />}

        {!rows ? (
          <CSpinner size="sm" />
        ) : rows.length === 0 ? (
          <CAlert color="info">{showingSearch ? 'No matches.' : 'Nothing here yet.'}</CAlert>
        ) : (
          <CTable hover responsive small>
            <CTableHead>
              <CTableRow>
                <CTableHeaderCell style={{ width: 40 }}></CTableHeaderCell>
                <CTableHeaderCell>Name</CTableHeaderCell>
                <CTableHeaderCell>Description</CTableHeaderCell>
                <CTableHeaderCell>Used in project</CTableHeaderCell>
              </CTableRow>
            </CTableHead>
            <CTableBody>
              {rows.map((row) => (
                <CTableRow key={`${row.type ?? 'item'}:${row.id}`}>
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
                      <CBadge color="success">Used</CBadge>
                    ) : (
                      <CBadge color="secondary">Not used</CBadge>
                    )}
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

export default LibraryBrowser
