import React from 'react'
import { CButton, CModal, CModalBody, CModalFooter, CModalHeader, CModalTitle } from '@coreui/react'
import NamedListManager from './NamedListManager'

/**
 * Generic "Config" popup (AGENTS_TO_DO.md, 2026-08-01) - wraps
 * NamedListManager in modal chrome for pages that manage a group list via
 * a popup form rather than a Settings tab of their own (unlike
 * processes/SettingsTab.jsx, which renders NamedListManager inline in a
 * CCard). Used by NodesList.jsx (Node Groups) and DevicesList.jsx (Device
 * Groups), each triggered by that page's own Config button, positioned
 * left of Clear Filters.
 */
const GroupsConfigModal = ({
  visible,
  onClose,
  title,
  addLabel,
  namePlaceholder,
  items,
  onAdd,
  onRename,
  onDelete,
}) => (
  <CModal visible={visible} onClose={onClose}>
    <CModalHeader>
      <CModalTitle>{title}</CModalTitle>
    </CModalHeader>
    <CModalBody>
      <NamedListManager
        addLabel={addLabel}
        namePlaceholder={namePlaceholder}
        items={items}
        onAdd={onAdd}
        onRename={onRename}
        onDelete={onDelete}
      />
    </CModalBody>
    <CModalFooter>
      <CButton color="secondary" variant="outline" onClick={onClose}>
        Close
      </CButton>
    </CModalFooter>
  </CModal>
)

export default GroupsConfigModal
