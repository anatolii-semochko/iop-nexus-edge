import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CButton,
  CFormCheck,
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
 * Per-device Settings popup (AGENTS_TO_DO.md, 2026-08-01) - unlike Nodes'
 * single-group NodeSettingsModal, a Device is a logical workplace that can
 * be in several Device Groups at once (shared devices, e.g. a siren in
 * both a "fire" and "intrusion" group), so this is a checkbox multiselect,
 * plus this device's own Node assignment (single, nullable) and its own
 * name - all edited together from the same popup ("Маппінг груп і нод
 * пристрою відбувається в Config попапі кожного елемента DN"; the Name
 * field is a 2026-08-01 follow-up). `device.device_group_ids`/`device.
 * node_id`/`device.name` already come back from GET /devices (see
 * routes/devices.ts's SELECT_DEVICE_LIST_BASE), so no separate fetch-on-
 * open is needed here, unlike ProcessSettingsModal's GroupCheckboxSection.
 */
const DeviceSettingsModal = ({ visible, onClose, device, deviceGroups, nodes, onSaved }) => {
  const [name, setName] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState(new Set())
  const [nodeId, setNodeId] = useState('')
  const [activeColor, setActiveColor] = useState('#2eb85c')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (visible && device) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(device.name)

      setSelectedGroupIds(new Set(device.device_group_ids ?? []))

      setNodeId(device.node_id ?? '')
      setActiveColor(device.capabilities?.color ?? '#2eb85c')
      setError(null)
    }
  }, [visible, device])

  const toggleGroup = (id) => {
    const next = new Set(selectedGroupIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setSelectedGroupIds(next)
  }

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
        api.renameDevice(device.id, trimmedName),
        api.setDeviceGroups(device.id, [...selectedGroupIds]),
        api.setDeviceNode(device.id, nodeId === '' ? null : Number(nodeId)),
        api.setDeviceCapabilities(device.id, { color: activeColor }),
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
        <CModalTitle>{device?.name} settings</CModalTitle>
      </CModalHeader>
      <CModalBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        <div className="mb-3">
          <CFormLabel>Name</CFormLabel>
          <CFormInput value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </div>
        <div className="mb-3">
          <CFormLabel>Node</CFormLabel>
          <CFormSelect value={nodeId} onChange={(e) => setNodeId(e.target.value)} disabled={busy}>
            <option value="">No node</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </CFormSelect>
        </div>
        <div className="mb-3">
          <CFormLabel>Physical ID</CFormLabel>
          <CFormInput
            value={device?.capabilities?.physicalId ?? ''}
            disabled
            placeholder="Not wired up yet"
          />
        </div>
        <div className="mb-3">
          <CFormLabel>Background color when active</CFormLabel>
          <div className="d-flex align-items-center gap-2">
            <CFormInput
              type="color"
              value={activeColor}
              onChange={(e) => setActiveColor(e.target.value)}
              disabled={busy}
              style={{ width: 60, padding: 2 }}
            />
            <span className="text-body-secondary small">
              Used behind this device&apos;s icon in the Devices list when its value is true.
            </span>
          </div>
        </div>
        <div>
          <div className="text-body-secondary small mb-2">Device Groups</div>
          {deviceGroups.length === 0 ? (
            <div className="text-body-secondary">Nothing here yet - add some via Config.</div>
          ) : (
            deviceGroups.map((g) => (
              <CFormCheck
                key={g.id}
                id={`device-group-${g.id}`}
                label={g.name}
                checked={selectedGroupIds.has(g.id)}
                disabled={busy}
                onChange={() => toggleGroup(g.id)}
              />
            ))
          )}
        </div>
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

export default DeviceSettingsModal
