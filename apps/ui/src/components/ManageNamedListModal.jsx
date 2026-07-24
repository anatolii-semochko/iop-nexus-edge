import React, { useState } from 'react'
import {
  CAlert,
  CButton,
  CForm,
  CFormInput,
  CListGroup,
  CListGroupItem,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { cilCheck, cilPencil, cilTrash, cilX } from '@coreui/icons'

/**
 * Generic "manage a named list" popup - add one, inline-rename one, delete
 * one if allowed. Built for process groups (AGENTS.md section 10/17) but
 * deliberately not Groups-specific: everything domain-specific is a prop,
 * so the next similar list (whatever it turns out to be) reuses this
 * instead of a copy-pasted modal.
 *
 * @param {boolean} visible
 * @param {() => void} onClose
 * @param {string} title - modal title, e.g. "Groups"
 * @param {string} addLabel - add button text, e.g. "Add Group"
 * @param {string} namePlaceholder - text input placeholder
 * @param {Array<{id: string|number, name: string, deletable?: boolean}>} items
 * @param {(name: string) => Promise<void>} onAdd
 * @param {(id: string|number, name: string) => Promise<void>} onRename
 * @param {(id: string|number) => Promise<void>} onDelete
 */
const ManageNamedListModal = ({
  visible,
  onClose,
  title,
  addLabel,
  namePlaceholder = 'Name',
  items,
  onAdd,
  onRename,
  onDelete,
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

  return (
    <CModal visible={visible} onClose={onClose}>
      <CModalHeader>
        <CModalTitle>{title}</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        <CForm className="d-flex gap-2 mb-3" onSubmit={handleAdd}>
          <CFormInput
            size="sm"
            placeholder={namePlaceholder}
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
          />
          <CButton type="submit" size="sm" color="success" disabled={busy || !newName.trim()}>
            {addLabel}
          </CButton>
        </CForm>
        <CListGroup>
          {items.length === 0 && (
            <CListGroupItem className="text-body-secondary">Nothing here yet.</CListGroupItem>
          )}
          {items.map((item) => (
            <CListGroupItem key={item.id} className="d-flex align-items-center gap-2">
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
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onClose}>
          Close
        </CButton>
      </CModalFooter>
    </CModal>
  )
}

export default ManageNamedListModal
