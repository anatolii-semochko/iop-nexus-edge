import React, { useEffect, useState } from 'react'
import {
  CAlert,
  CAvatar,
  CBadge,
  CButton,
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
import { cilCheck, cilX } from '@coreui/icons'
import { api } from '../../api/client'
import TablePagination from '../../components/table/TablePagination'
import TableSearchInput from '../../components/table/TableSearchInput'
import { usePagination } from '../../hooks/usePagination'
import UserForm from './UserForm'

const matchesSearch = (user, search) => {
  if (!search) return true
  const needle = search.toLowerCase()
  return [user.username, user.display_name].some((field) => field?.toLowerCase().includes(needle))
}

// Delete is destructive and rare - arm it with one click, then require a
// second click within a few seconds to actually confirm, rather than a
// separate confirm modal for a single button.
const DeleteButton = ({ user, onDeleted, onError }) => {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!user.deletable) {
    return (
      <CButton size="sm" color="secondary" variant="outline" disabled>
        Delete
      </CButton>
    )
  }

  const handleClick = async () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 3000)
      return
    }
    setBusy(true)
    try {
      await api.deleteUser(user.id)
      onDeleted()
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  return (
    <CButton
      size="sm"
      color={armed ? 'danger' : 'secondary'}
      variant={armed ? undefined : 'outline'}
      disabled={busy}
      onClick={handleClick}
    >
      {busy ? <CSpinner size="sm" /> : armed ? 'Confirm delete?' : 'Delete'}
    </CButton>
  )
}

const UsersList = () => {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [editingUser, setEditingUser] = useState(null)
  const [creating, setCreating] = useState(false)

  const reload = () => {
    api
      .listUsers()
      .then((all) => {
        setUsers(all)
        setError(null)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(reload, [])

  const filtered = (users ?? []).filter((user) => matchesSearch(user, search))
  const { page, pageSize, pageItems, totalItems, setPage, setPageSize } = usePagination(filtered)

  const handleToggleActive = async (user) => {
    try {
      await api.updateUser(user.id, { active: !user.active })
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleFormSaved = () => {
    setEditingUser(null)
    setCreating(false)
    reload()
  }

  return (
    <CCard className="mb-4">
      <CCardHeader className="d-flex justify-content-between align-items-center">
        <strong>Users</strong>
        <CButton size="sm" color="primary" onClick={() => setCreating(true)}>
          Add user
        </CButton>
      </CCardHeader>
      <CCardBody>
        {error && <CAlert color="danger">{error}</CAlert>}
        {!error && !users && <CSpinner color="primary" />}
        {!error && users && (
          <>
            <div className="mb-3">
              <TableSearchInput
                value={search}
                onSearch={setSearch}
                placeholder="Search by username, name..."
              />
            </div>
            {filtered.length === 0 ? (
              <CAlert color="info">
                {users.length === 0 ? 'No users yet.' : 'No users match this search.'}
              </CAlert>
            ) : (
              <>
                <CTable hover responsive>
                  <CTableHead>
                    <CTableRow>
                      <CTableHeaderCell scope="col" />
                      <CTableHeaderCell scope="col">Username</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Display name</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Roles</CTableHeaderCell>
                      <CTableHeaderCell scope="col">Status</CTableHeaderCell>
                      <CTableHeaderCell scope="col" className="text-end">
                        Actions
                      </CTableHeaderCell>
                    </CTableRow>
                  </CTableHead>
                  <CTableBody>
                    {pageItems.map((user) => (
                      <CTableRow key={user.id}>
                        <CTableDataCell>
                          <div className="position-relative d-inline-block">
                            {user.avatar_path ? (
                              <CAvatar src={`/api/uploads/avatars/${user.avatar_path}`} size="md" />
                            ) : (
                              <CAvatar color="secondary" textColor="white" size="md">
                                {(user.display_name ?? user.username)[0].toUpperCase()}
                              </CAvatar>
                            )}
                            {/* Same active/inactive flag as the avatar field
                                in UserForm.jsx - not an action here either.
                                Sized smaller here (proportional to the "md"
                                CAvatar this sits on, vs the form's "4rem"
                                one) - the form's own 1.25rem badge looked
                                right against a much bigger avatar, but was
                                oversized against this smaller one. */}
                            <CAvatar
                              color={user.active ? 'success' : 'danger'}
                              textColor="white"
                              className="position-absolute p-0 d-flex align-items-center justify-content-center"
                              style={{
                                width: '0.85rem',
                                height: '0.85rem',
                                top: '-0.15rem',
                                right: '-0.15rem',
                              }}
                            >
                              <CIcon icon={user.active ? cilCheck : cilX} height={8} width={8} />
                            </CAvatar>
                          </div>
                        </CTableDataCell>
                        <CTableDataCell>{user.username}</CTableDataCell>
                        <CTableDataCell>{user.display_name ?? '-'}</CTableDataCell>
                        <CTableDataCell>
                          {user.roles.length === 0
                            ? '-'
                            : user.roles.map((role) => (
                                <CBadge key={role} color="info" className="me-1">
                                  {role}
                                </CBadge>
                              ))}
                        </CTableDataCell>
                        <CTableDataCell>
                          <CBadge color={user.active ? 'success' : 'secondary'}>
                            {user.active ? 'Active' : 'Inactive'}
                          </CBadge>
                        </CTableDataCell>
                        <CTableDataCell className="text-end">
                          <CButton
                            size="sm"
                            color="secondary"
                            variant="outline"
                            className="me-1"
                            onClick={() => setEditingUser(user)}
                          >
                            Edit
                          </CButton>
                          <CButton
                            size="sm"
                            color="secondary"
                            variant="outline"
                            className="me-1"
                            disabled={user.active && !user.deactivatable}
                            onClick={() => handleToggleActive(user)}
                          >
                            {user.active ? 'Deactivate' : 'Activate'}
                          </CButton>
                          <DeleteButton user={user} onDeleted={reload} onError={setError} />
                        </CTableDataCell>
                      </CTableRow>
                    ))}
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
        {(editingUser || creating) && (
          <UserForm
            user={editingUser}
            onClose={() => {
              setEditingUser(null)
              setCreating(false)
            }}
            onSaved={handleFormSaved}
          />
        )}
      </CCardBody>
    </CCard>
  )
}

export default UsersList
