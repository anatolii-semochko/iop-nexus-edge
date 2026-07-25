// Shared bright, rounded background for WEM-classified text (AGENTS.md
// section 22, error/warning/message) - a solid, saturated background, not
// the pale "-subtle" variant used for row highlighting elsewhere - always
// paired with plain black text rather than a matching-tinted one, since
// the bright background is already the signal. Reused by WemRow (the
// message list) and ResourceMonitorPanel (per-metric value chips).
const WEM_BADGE_BG = {
  error: 'bg-danger',
  warning: 'bg-warning',
  message: 'bg-success',
}

export function wemBadgeClass(type) {
  const bg = WEM_BADGE_BG[type]
  return bg ? `${bg} rounded-pill text-black` : ''
}
