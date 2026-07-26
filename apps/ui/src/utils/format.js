/**
 * Timestamp display helpers (AGENTS.md section 12). All inputs are the raw
 * ISO strings Postgres/Fastify already return (e.g. `last_heartbeat_at`,
 * `created_at`) - nothing here talks to an API or owns any state.
 */

export function formatDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]

// Just the units above; anything shorter is reported as "just now" rather
// than "12 seconds ago" - second-level precision isn't meaningful for a
// heartbeat/last-updated column.
export function formatRelativeTime(iso) {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < RELATIVE_UNITS[RELATIVE_UNITS.length - 1][1]) return 'just now'
  for (const [unit, unitMs] of RELATIVE_UNITS) {
    const count = Math.floor(diffMs / unitMs)
    if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

// No heartbeat ever received (`iso` nullish) counts as stale - a device/node
// that has never reported in is not "fresh by default".
export function isStale(iso, thresholdMs) {
  if (!iso) return true
  return Date.now() - new Date(iso).getTime() > thresholdMs
}

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

// Today/Yesterday/date + time-to-the-minute (notification center, AGENTS.md
// section 25) - a plain `toLocaleString()` (formatDateTime above) is too
// wide and includes seconds, which don't matter for a feed sorted newest-
// first; a relative "N minutes ago" (formatRelativeTime above) is right for
// a single "last updated" field but reads badly on a long list where every
// row needs its own reference point, not "ago" repeated down the column.
export function formatSmartDateTime(iso) {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  if (sameDay(date, now)) return `Today, ${time}`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(date, yesterday)) return `Yesterday, ${time}`

  const datePart = date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
  return `${datePart}, ${time}`
}
