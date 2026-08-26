import React, { useEffect, useState } from 'react'
import { CAlert, CBadge, CSpinner, CTab, CTabList, CTabs } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilLibrary } from '@coreui/icons'
import { api } from '../../api/client'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'compatibility', label: 'Compatibility' },
  { key: 'technical', label: 'Technical' },
]

const Empty = ({ children }) => <div className="text-body-secondary small">{children}</div>

const iconUrl = (iconPath) => (iconPath ? `/api${iconPath}` : null)

const OverviewTab = ({ row, detail }) => {
  const url = iconUrl(row.iconPath)
  return (
    <div className="d-flex gap-4">
      <div className="flex-shrink-0 text-center">
        {url ? (
          <img src={url} alt="" style={{ width: 96, height: 96, objectFit: 'contain' }} />
        ) : (
          <CIcon icon={cilLibrary} size="3xl" className="text-body-secondary" />
        )}
        <div className="text-body-secondary small mt-1">{row.typeName}</div>
      </div>
      <div>
        <div className="fw-semibold mb-1">{row.name}</div>
        <div>{row.description ?? <Empty>No description.</Empty>}</div>
        {detail.technical?.kind === 'node' && (
          <div className="text-body-secondary small mt-2">
            {detail.technical.hasFirmware
              ? 'Firmware scaffold present.'
              : 'No firmware scaffold yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

// Rendered as preformatted monospace text, not parsed markdown - these
// files are already written to read fine as plain text (short
// paragraphs, `code` spans), and pulling in a markdown-rendering
// dependency for this one read-only view isn't worth it (AGENTS_TO_DO.md,
// 2026-08-27).
const DocumentationTab = ({ detail }) =>
  detail.readme || detail.changelog ? (
    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
      {detail.readme && (
        <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>
          {detail.readme}
        </pre>
      )}
      {detail.changelog && (
        <>
          <hr />
          <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>
            {detail.changelog}
          </pre>
        </>
      )}
    </div>
  ) : (
    <Empty>No docs/README.md or CHANGELOG.md for this item yet.</Empty>
  )

const CompatibilityTab = ({ kind, detail }) => (
  <>
    {detail.compatibility.length === 0 ? (
      <Empty>
        {kind === 'node'
          ? "No device types listed in this node's own node.yaml supports: list."
          : 'No node type currently lists this device type in its own supports: list.'}
      </Empty>
    ) : (
      <div className="d-flex flex-wrap gap-2 mb-3">
        {detail.compatibility.map((c) => (
          <div key={c.id} className="d-flex align-items-center gap-1 border rounded px-2 py-1">
            {iconUrl(c.iconPath) ? (
              <img
                src={iconUrl(c.iconPath)}
                alt=""
                style={{ width: 16, height: 16, objectFit: 'contain' }}
              />
            ) : (
              <CIcon icon={cilLibrary} size="sm" className="text-body-secondary" />
            )}
            <span className="small">{c.name}</span>
          </div>
        ))}
      </div>
    )}
    {detail.forbidden && (
      <div>
        <div className="text-body-secondary small mb-1">Forbidden-state rules (safety.yaml)</div>
        <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(detail.forbidden, null, 2)}
        </pre>
      </div>
    )}
  </>
)

const TechnicalTab = ({ detail }) => {
  const t = detail.technical
  if (!t) return <Empty>No technical specs on file for this item.</Empty>
  if (t.kind === 'device') {
    return (
      <>
        <div className="mb-2">
          {t.manufacturer && (
            <div>
              <span className="text-body-secondary small">Manufacturer:</span> {t.manufacturer}
            </div>
          )}
          {t.model && (
            <div>
              <span className="text-body-secondary small">Model:</span> {t.model}
            </div>
          )}
          {t.labels && t.labels.length > 0 && (
            <div className="mt-1">
              {t.labels.map((label) => (
                <CBadge key={label} color="secondary" className="me-1 mb-1">
                  {label}
                </CBadge>
              ))}
            </div>
          )}
        </div>
        {t.resources.length > 0 && (
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Value type</th>
                <th>R/W</th>
              </tr>
            </thead>
            <tbody>
              {t.resources.map((r) => (
                <tr key={r.name}>
                  <td>
                    {r.name}
                    {r.description && (
                      <div className="text-body-secondary small">{r.description}</div>
                    )}
                  </td>
                  <td>{r.valueType ?? '-'}</td>
                  <td>{r.readWrite ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    )
  }
  // kind === 'node'
  return (
    <div>
      <div>
        <span className="text-body-secondary small">Bus:</span> {t.busType ?? 'unspecified'}
      </div>
      <div>
        <span className="text-body-secondary small">Firmware scaffold:</span>{' '}
        {t.hasFirmware ? 'present' : 'none yet'}
      </div>
    </div>
  )
}

/**
 * Expanded-row detail for one Library item (AGENTS_TO_DO.md, 2026-08-27
 * "Можеш запропонувати, що корисного ми могли би показувати в
 * розгортках елементів бібліотек?") - four tabs over what's already on
 * disk per DN (AGENTS.md section 7's own file layout), fetched fresh via
 * `GET /library/items/:id/detail` on mount rather than pulled from the
 * already-loaded row, since README/CHANGELOG/EdgeX-profile content isn't
 * part of the synced `library_items` row at all (see
 * libraryCatalog.ts's own getLibraryItemDetail doc comment for why).
 * Same "CTabs/CTabList + conditionally-rendered content, not CTabContent/
 * CTabPanel" idiom AquariumLightControlPanel.jsx already uses, so
 * switching tabs doesn't re-fetch.
 */
const LibraryItemDetailRow = ({ row, kind }) => {
  const [activeTab, setActiveTab] = useState('overview')
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    // This component mounts fresh every time a row is expanded (see the
    // `expandedRow &&` guard in LibraryBrowser) and unmounts on
    // collapse, so `row.id` never actually changes within one mount's
    // lifetime - same "runs once on mount to fetch" pattern
    // AddProcessModal.jsx's own effect above already uses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null)
    setError(null)
    api
      .getLibraryItemDetail(row.id)
      .then(setDetail)
      .catch((err) => setError(err.message))
  }, [row.id])

  if (error) return <CAlert color="danger">{error}</CAlert>
  if (!detail) return <CSpinner size="sm" />

  return (
    <div className="p-3">
      <CTabs activeItemKey={activeTab} onChange={setActiveTab}>
        <CTabList variant="tabs" className="mb-3">
          {TABS.map((tab) => (
            <CTab key={tab.key} itemKey={tab.key}>
              {tab.label}
            </CTab>
          ))}
        </CTabList>
      </CTabs>
      {activeTab === 'overview' && <OverviewTab row={row} detail={detail} />}
      {activeTab === 'documentation' && <DocumentationTab detail={detail} />}
      {activeTab === 'compatibility' && <CompatibilityTab kind={kind} detail={detail} />}
      {activeTab === 'technical' && <TechnicalTab detail={detail} />}
    </div>
  )
}

export default LibraryItemDetailRow
