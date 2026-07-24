import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  CAvatar,
  CDropdown,
  CDropdownDivider,
  CDropdownHeader,
  CDropdownItem,
  CDropdownMenu,
  CDropdownToggle,
} from '@coreui/react'
import { cilLockLocked, cilPeople } from '@coreui/icons'
import CIcon from '@coreui/icons-react'
import { api } from '../../api/client'

const initials = (user) =>
  (user.display_name ?? user.username)
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

/**
 * The logged-in-user menu (AGENTS.md section 13). Replaces the CoreUI demo
 * dropdown's fake Updates/Messages/Tasks/Comments/Payments/Projects items -
 * those had nothing to do with a real account menu and would look broken
 * sitting next to a working Logout button.
 */
const AppHeaderDropdown = () => {
  const user = useSelector((state) => state.user)
  const dispatch = useDispatch()
  const navigate = useNavigate()

  if (!user) return null
  const isAdmin = user.roles.includes('admin')

  const handleLogout = async () => {
    try {
      await api.logout()
    } finally {
      dispatch({ type: 'set', user: null })
      navigate('/login')
    }
  }

  return (
    <CDropdown variant="nav-item">
      <CDropdownToggle placement="bottom-end" className="py-0 pe-0" caret={false}>
        {user.avatar_path ? (
          <CAvatar src={`/api/uploads/avatars/${user.avatar_path}`} size="md" />
        ) : (
          <CAvatar color="secondary" textColor="white" size="md">
            {initials(user)}
          </CAvatar>
        )}
      </CDropdownToggle>
      <CDropdownMenu className="pt-0" placement="bottom-end">
        <CDropdownHeader className="bg-body-secondary fw-semibold mb-2">
          {user.display_name ?? user.username}
        </CDropdownHeader>
        {isAdmin && (
          <CDropdownItem href="#/users">
            <CIcon icon={cilPeople} className="me-2" />
            Users
          </CDropdownItem>
        )}
        <CDropdownDivider />
        <CDropdownItem onClick={handleLogout} style={{ cursor: 'pointer' }}>
          <CIcon icon={cilLockLocked} className="me-2" />
          Logout
        </CDropdownItem>
      </CDropdownMenu>
    </CDropdown>
  )
}

export default AppHeaderDropdown
