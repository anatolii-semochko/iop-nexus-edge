import { useEffect, useState } from 'react'

/**
 * Current time (ms epoch), refreshed every `intervalMs` - for any
 * "is this stale/overdue" comparison that needs to re-evaluate as time
 * passes without a new prop/event triggering the render itself (e.g.
 * DevicesList.jsx's own overdue check, AGENTS_TO_DO.md 2026-08-14).
 * Calling `Date.now()` directly during render is impure/lint-flagged
 * (react-hooks/purity) - this hook is the one place that's allowed to,
 * inside an effect, not render itself.
 */
export function useNow(intervalMs = 5000) {
  // Starts at 0 (falsy/definitely-in-the-past), not Date.now() - a lazy
  // useState initializer still runs during render, same purity concern.
  // Corrects itself on the first effect tick, well before intervalMs.
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
