import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'

import { CSpinner } from '@coreui/react'
import { api } from '../api/client'

/**
 * Wraps the whole authenticated app shell (AGENTS.md section 13 - UI login
 * only, not per-endpoint API authorization). On mount, checks for an
 * existing session (`GET /auth/me` - the httpOnly cookie set at login rides
 * along automatically) so a page refresh doesn't force a re-login; redirects
 * to `/login` if there isn't one. Once `user` is already in the store (set
 * directly by Login.jsx right after a successful login, or already present
 * from an earlier mount), the check is skipped entirely rather than
 * re-verified - not because it's unnecessary, but because Login.jsx already
 * has the freshest possible answer for that case.
 */
const AuthGate = ({ children }) => {
  const user = useSelector((state) => state.user)
  const dispatch = useDispatch()
  const [checked, setChecked] = useState(Boolean(user))

  useEffect(() => {
    if (user) return
    api
      .getCurrentUser()
      .then(({ user: currentUser }) => dispatch({ type: 'set', user: currentUser }))
      .catch(() => {
        // No session (never logged in, expired, or logged out elsewhere) -
        // the redirect below handles it, nothing to surface as an error.
      })
      .finally(() => setChecked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!checked) {
    return (
      <div className="pt-3 text-center">
        <CSpinner color="primary" variant="grow" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default AuthGate
