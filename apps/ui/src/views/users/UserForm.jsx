import React, { useState } from 'react'
import {
  CAlert,
  CButton,
  CCol,
  CForm,
  CFormCheck,
  CFormInput,
  CFormLabel,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CRow,
  CSpinner,
} from '@coreui/react'
import { api } from '../../api/client'

/**
 * Create/edit modal (AGENTS.md section 13). `roles` only ever has one
 * meaningful value today ('admin') - a single checkbox, not a generic
 * multi-select, until a second role actually exists server-side
 * (ALLOWED_ROLES in apps/api/src/routes/users.ts). Avatar upload only shows
 * up while editing - a brand-new user has no id yet to upload against.
 */
const UserForm = ({ user, onClose, onSaved }) => {
  const isEdit = Boolean(user)
  const [username, setUsername] = useState(user?.username ?? '')
  const [displayName, setDisplayName] = useState(user?.display_name ?? '')
  const [password, setPassword] = useState('')
  const [isAdminRole, setIsAdminRole] = useState(user?.roles.includes('admin') ?? false)
  const [active, setActive] = useState(user?.active ?? true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const canDeactivate = user?.deactivatable ?? true

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const roles = isAdminRole ? ['admin'] : []
      if (isEdit) {
        const body = { display_name: displayName, roles, active }
        if (password) body.password = password
        await api.updateUser(user.id, body)
      } else {
        await api.createUser({ username, password, display_name: displayName, roles, active })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setAvatarBusy(true)
    setError(null)
    try {
      await api.uploadAvatar(user.id, file)
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setAvatarBusy(false)
    }
  }

  return (
    <CModal visible onClose={onClose}>
      <CModalHeader>
        <CModalTitle>{isEdit ? `Edit ${user.username}` : 'Add user'}</CModalTitle>
      </CModalHeader>
      <CForm onSubmit={handleSubmit}>
        <CModalBody>
          {error && <CAlert color="danger">{error}</CAlert>}
          <CRow className="mb-3">
            <CCol>
              <CFormLabel>Username</CFormLabel>
              <CFormInput
                value={username}
                disabled={isEdit}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </CCol>
          </CRow>
          <CRow className="mb-3">
            <CCol>
              <CFormLabel>Display name</CFormLabel>
              <CFormInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </CCol>
          </CRow>
          <CRow className="mb-3">
            <CCol>
              <CFormLabel>
                {isEdit ? 'New password (leave blank to keep current)' : 'Password'}
              </CFormLabel>
              <CFormInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!isEdit}
              />
            </CCol>
          </CRow>
          <CRow className="mb-3">
            <CCol>
              <CFormCheck
                label="Admin role"
                checked={isAdminRole}
                onChange={(e) => setIsAdminRole(e.target.checked)}
              />
            </CCol>
          </CRow>
          <CRow className="mb-3">
            <CCol>
              <CFormCheck
                label="Active"
                checked={active}
                disabled={!canDeactivate}
                onChange={(e) => setActive(e.target.checked)}
              />
              {!canDeactivate && (
                <div className="form-text">This account can never be deactivated.</div>
              )}
            </CCol>
          </CRow>
          {isEdit && (
            <CRow className="mb-3">
              <CCol>
                <CFormLabel>Avatar</CFormLabel>
                <CFormInput
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={avatarBusy}
                  onChange={handleAvatarChange}
                />
              </CCol>
            </CRow>
          )}
        </CModalBody>
        <CModalFooter>
          <CButton color="secondary" variant="outline" onClick={onClose}>
            Cancel
          </CButton>
          <CButton type="submit" color="primary" disabled={busy}>
            {busy ? <CSpinner size="sm" /> : 'Save'}
          </CButton>
        </CModalFooter>
      </CForm>
    </CModal>
  )
}

export default UserForm
