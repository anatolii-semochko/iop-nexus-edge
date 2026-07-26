import { cilEnvelopeLetter, cilWarning, cilXCircle } from '@coreui/icons'

// Shared by NotificationCenter.jsx (header icons) and NotificationCenterModal.
// jsx (type selector, per-row message coloring) - its own module rather than
// exported from either of those two, which otherwise import each other
// (NotificationCenter renders the modal, the modal reuses this constant) -
// a real circular import that "worked" only as long as both sides only
// touched this at render time, not at module-evaluation time (caught live:
// NotificationCenterModal's TYPE_OPTIONS builds from this at module top
// level, which starts throwing "Cannot convert undefined or null to
// object" the moment either side evaluates before the other has finished).
export const WEM_TYPE_META = {
  message: { icon: cilEnvelopeLetter, color: 'success', label: 'Messages' },
  warning: { icon: cilWarning, color: 'warning', label: 'Warnings' },
  error: { icon: cilXCircle, color: 'danger', label: 'Errors' },
}
