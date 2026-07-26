import React, { useState } from 'react'
import { CBadge } from '@coreui/react'
import CIcon from '@coreui/icons-react'
import { useProcessesLiveState, useUnreadCounts } from '../../api/useLiveProcess'
import NotificationCenterModal from './NotificationCenterModal'
import { WEM_TYPE_META } from './wemTypeMeta'

/**
 * The three header notification icons (AGENTS.md section 25) - messages/
 * warnings/errors, each opening the same NotificationCenterModal preset to
 * its own type. Two independent live signals per icon, both riding the
 * fleet broadcast (section 24) rather than any polling:
 * - color (neutral vs tinted) - driven by `useUnreadCounts()`, > 0 unread;
 * - blink (`.wem-blink-ring`, warning/error only) - driven by whether
 *   *any* process currently has that icon's own flag true, not by unread
 *   count at all (an already-read but still-active condition still
 *   blinks; an unread-but-resolved one does not). Warning and error are
 *   deliberately two *separate* flags (`p.warning` / `p.critical`), not
 *   one shared "either" boolean applied to both icons - a process is
 *   never both at once (critical always wins - AGENTS.md section 21), so
 *   conflating them made the warning icon blink for an error-only
 *   condition and vice versa (caught live).
 */
const NotificationCenter = () => {
  const counts = useUnreadCounts()
  const live = useProcessesLiveState()
  const processes = Object.values(live)
  const hasActiveWarning = processes.some((p) => p.warning)
  const hasActiveError = processes.some((p) => p.critical)
  const [openType, setOpenType] = useState(null)

  return (
    <>
      {Object.entries(WEM_TYPE_META).map(([type, meta]) => {
        const unread = counts[type] ?? 0
        const blink =
          type === 'warning' ? hasActiveWarning : type === 'error' ? hasActiveError : false
        // Blinking swaps to a solid pulsing disc behind a light icon
        // ("інверсна іконка") - a plain opacity-faded outline (the
        // original treatment) turned out too subtle to actually notice
        // at a glance (reported live) - CoreUI's cil set has no filled/
        // inverse icon variants to reach for instead.
        const iconColorClass = blink
          ? 'text-white'
          : unread > 0
            ? `text-${meta.color}`
            : 'text-body-secondary'
        return (
          <button
            key={type}
            type="button"
            className="btn position-relative p-0 mx-2 border-0 bg-transparent"
            aria-label={meta.label}
            onClick={() => setOpenType(type)}
          >
            <span
              className={`d-inline-flex align-items-center justify-content-center rounded-circle ${blink ? `bg-${meta.color} wem-blink-ring` : ''}`}
              style={{ width: '2.25rem', height: '2.25rem' }}
            >
              <CIcon icon={meta.icon} size="lg" className={iconColorClass} />
            </span>
            {unread > 0 && (
              <CBadge
                color={meta.color}
                position="top-end"
                shape="rounded-pill"
                style={{ fontSize: '0.55rem' }}
              >
                {unread > 99 ? '99+' : unread}
                <span className="visually-hidden">unread {meta.label.toLowerCase()}</span>
              </CBadge>
            )}
          </button>
        )
      })}
      <NotificationCenterModal
        type={openType}
        onTypeChange={setOpenType}
        onClose={() => setOpenType(null)}
      />
    </>
  )
}

export default NotificationCenter
