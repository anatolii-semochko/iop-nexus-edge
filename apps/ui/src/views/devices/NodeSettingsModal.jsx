import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CButton,
  CFormInput,
  CFormLabel,
  CFormSelect,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CSpinner,
} from '@coreui/react'
import { api } from '../../api/client'

/**
 * Per-node Settings popup (AGENTS_TO_DO.md, 2026-08-01) - a Node is a
 * physical workplace served locally by exactly one group of Nodes, so
 * the group field is a single dropdown, not the checkbox-multiselect
 * shape ProcessSettingsModal/DeviceSettingsModal use for many-to-many
 * memberships. Also renames the node itself (2026-08-01 follow-up: "у
 * форму Config потрібно додати поле зміни Name"). `node.group_id`/
 * `node.name` already come back from GET /nodes (see routes/nodes.ts's
 * SELECT_NODE join), so no separate fetch-on-open is needed here.
 */
const NodeSettingsModal = ({ visible, onClose, node, nodeGroups, onSaved }) => {
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (visible && node) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(node.name)

      setGroupId(node.group_id ?? '')
      setError(null)
    }
  }, [visible, node])

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await Promise.all([
        api.renameNode(node.id, trimmedName),
        api.setNodeGroup(node.id, groupId === '' ? null : Number(groupId)),
      ])
      onSaved?.()
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
        <CModalTitle>{node?.name} settings</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        <div className="mb-3">
          <CFormLabel>Name</CFormLabel>
          <CFormInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <CFormLabel>Node Group</CFormLabel>
        <CFormSelect value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={busy}>
          <option value="">No group</option>
          {nodeGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </CFormSelect>
      </CModalBody>
      <CModalFooter>
        <CButton color="secondary" variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </CButton>
        <CButton color="success" onClick={handleSave} disabled={busy}>
          {busy ? <CSpinner size="sm" /> : 'Save'}
        </CButton>
      </CModalFooter>
    </CModal>
  )
}

export default NodeSettingsModal
