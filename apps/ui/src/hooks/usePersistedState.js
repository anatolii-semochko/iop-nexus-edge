import { useState } from 'react'
import { readCookie, writeCookie } from '../utils/cookies'

/**
 * Per-page UI state (filters, search text, page size, expanded rows, ...)
 * that survives a refresh - the handful of things someone sets up while
 * actually using a page, not durable data (that stays in Postgres, never
 * in a cookie).
 *
 * `defaults` is the registration, not just a fallback: its keys are
 * exactly what this hook tracks and persists, and its values are what a
 * first-ever visit (or a cookie missing that key) starts from. A field
 * added to `defaults` later just starts defaulting until the user changes
 * it; a field removed from `defaults` stops being read even if an old
 * cookie still has it - the schema, not the cookie, decides what exists.
 *
 * @param {string} cookieName - unique per page, e.g. 'nexusedge.processes'
 * @param {Object} defaults - { fieldName: defaultValue, ... }
 * @returns {[Object, (partial: Object) => void]}
 */
export function usePersistedState(cookieName, defaults) {
  const [state, setStateRaw] = useState(() => {
    const saved = readCookie(cookieName)
    if (!saved) return defaults

    let parsed
    try {
      parsed = JSON.parse(saved)
    } catch {
      return defaults
    }

    const merged = { ...defaults }
    for (const key of Object.keys(defaults)) {
      if (key in parsed) merged[key] = parsed[key]
    }
    return merged
  })

  const setState = (partial) => {
    setStateRaw((prev) => {
      const next = { ...prev, ...partial }
      writeCookie(cookieName, JSON.stringify(next))
      return next
    })
  }

  return [state, setState]
}
