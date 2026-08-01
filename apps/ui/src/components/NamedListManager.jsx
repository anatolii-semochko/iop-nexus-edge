import React, { useState } from 'react'
import {
  CAlert,
  CButton,
  CForm,
  CFormInput,
  CListGroup,
  CListGroupItem,
  CSpinner,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilArrowBottom, cilArrowTop, cilCheck, cilPencil, cilTrash, cilX } from '@coreui/icons'

/**
 * Generic "manage a named list" body - add one, inline-rename one, delete
 * one if allowed, optionally reorder. Extracted from the old
 * ManageNamedListModal popup (AGENTS.md section 10/17/22) into a bare
 * component with no CModal chrome, since both consumers today (the
 * Process Groups and Message Groups sections of the Processes page's
 * Settings tab) render inline, not in a popup - nothing left needs the
 * modal wrapper.
 *
 * @param {string} addLabel - add button text, e.g. "Add Group"
 * @param {string} namePlaceholder - text input placeholder
 * @param {Array<{id: string|number, name: string, deletable?: boolean}>} items
 * @param {(name: string) => Promise<void>} onAdd
 * @param {(id: string|number, name: string) => Promise<void>} onRename
 * @param {(id: string|number) => Promise<void>} onDelete
 * @param {boolean} [orderable] - show up/down move buttons (Message Groups
 *   only - Process Groups has no ordering concept).
 * @param {(orderedIds: Array<string|number>) => Promise<void>} [onReorder]
 */
const NamedListManager = ({
  addLabel,
  namePlaceholder = 'Name',
  items,
  onAdd,
  onRename,
  onDelete,
  orderable = false,
  onReorder,
}) => {
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(newName.trim())
      setNewName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const startEditing = (item) => {
    setEditingId(item.id)
    setEditingName(item.name)
    setError(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingName('')
  }

  const saveEditing = async () => {
    if (!editingName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onRename(editingId, editingName.trim())
      cancelEditing()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id) => {
    setBusy(true)
    setError(null)
    try {
      await onDelete(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Swaps `item` with its neighbor in `items`' own current order (already
  // the display/position order, per the caller) and resends the *complete*
  // new order - matches the reorder endpoint's own "whole list, not a
  // single move" contract (apps/api/src/routes/messageGroups.ts).
  const move = async (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const reordered = [...items]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setBusy(true)
    setError(null)
    try {
      await onReorder(reordered.map((item) => item.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {error && <CAlert color="danger">{error}</CAlert>}
      <CForm className="d-flex gap-2 mb-3" onSubmit={handleAdd}>
        <CFormInput
          size="sm"
          placeholder={namePlaceholder}
          value={newName}
          disabled={busy}
          onChange={(e) => setNewName(e.target.value)}
        />
        {/* nowrap - a narrow flex container (this CForm shrinks the
            CFormInput's sibling first) can otherwise squeeze a two-word
            label like "Add Group" onto two lines, doubling the button's
            own height against every other `size="sm"` control next to it
            (2026-08-01 follow-up, caught live). */}
        <CButton
          type="submit"
          size="sm"
          color="success"
          className="text-nowrap"
          disabled={busy || !newName.trim()}
        >
          {addLabel}
        </CButton>
      </CForm>
      <CListGroup>
        {items.length === 0 && (
          <CListGroupItem className="text-body-secondary">Nothing here yet.</CListGroupItem>
        )}
        {items.map((item, index) => (
          <CListGroupItem key={item.id} className="d-flex align-items-center gap-2">
            {orderable && (
              <div>
                <CButton
                  size="sm"
                  color="secondary"
                  variant="ghost"
                  disabled={busy || index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="Move up"
                  style={{ padding: '0.1rem 0.3rem' }}
                >
                  <CIcon icon={cilArrowTop} size="sm" />
                </CButton>
                <CButton
                  size="sm"
                  color="secondary"
                  variant="ghost"
                  disabled={busy || index === items.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="Move down"
                  style={{ padding: '0.1rem 0.3rem' }}
                >
                  <CIcon icon={cilArrowBottom} size="sm" />
                </CButton>
              </div>
            )}
            {editingId === item.id ? (
              <>
                <CFormInput
                  size="sm"
                  autoFocus
                  value={editingName}
                  disabled={busy}
                  onChange={(e) => setEditingName(e.target.value)}
                />
                <CButton
                  size="sm"
                  color="success"
                  variant="ghost"
                  disabled={busy || !editingName.trim()}
                  onClick={saveEditing}
                  aria-label="Save"
                >
                  <CIcon icon={cilCheck} />
                </CButton>
                <CButton
                  size="sm"
                  color="secondary"
                  variant="ghost"
                  disabled={busy}
                  onClick={cancelEditing}
                  aria-label="Cancel"
                >
                  <CIcon icon={cilX} />
                </CButton>
              </>
            ) : (
              <>
                <span className="flex-grow-1">{item.name}</span>
                <CButton
                  size="sm"
                  color="secondary"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => startEditing(item)}
                  aria-label="Rename"
                >
                  <CIcon icon={cilPencil} />
                </CButton>
                <CButton
                  size="sm"
                  color="danger"
                  variant="ghost"
                  disabled={busy || item.deletable === false}
                  onClick={() => handleDelete(item.id)}
                  aria-label="Delete"
                >
                  {busy ? <CSpinner size="sm" /> : <CIcon icon={cilTrash} />}
                </CButton>
              </>
            )}
          </CListGroupItem>
        ))}
      </CListGroup>
    </div>
  )
}

export default NamedListManager
