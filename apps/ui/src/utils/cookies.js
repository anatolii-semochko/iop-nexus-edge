/**
 * Minimal document.cookie read/write - no external dependency for what's
 * two small string operations. Used by hooks/usePersistedState.js to
 * remember a page's own filter/search/pagination/expansion state across a
 * refresh (AGENTS.md section 17) - never for anything that belongs in
 * Postgres or the session cookie apps/api sets.
 */

export function readCookie(name) {
  const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function writeCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}
