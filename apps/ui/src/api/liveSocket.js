/**
 * Live device/resource state pushed by apps/messaging-gateway over
 * WebSocket (see AGENTS.md section 9) - one shared connection for the
 * whole app, proxied through nginx at the relative `/ws` path (same
 * same-origin reasoning as api/client.js's `/api` proxy - no CORS, no
 * dependency on which host/port the gateway container is mapped to).
 * Lazily opened on first subscriber, reconnects automatically with a
 * fixed delay on drop.
 */

const WS_PATH = '/ws'
const RECONNECT_DELAY_MS = 2000

let socket = null
let reconnectTimer = null
let connected = false
const eventListeners = new Set()
const statusListeners = new Set()

function setConnected(value) {
  connected = value
  statusListeners.forEach((listener) => listener(connected))
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${protocol}//${window.location.host}${WS_PATH}`)

  socket.addEventListener('open', () => setConnected(true))

  socket.addEventListener('message', (message) => {
    let payload
    try {
      payload = JSON.parse(message.data)
    } catch {
      return
    }
    // Both message types carry the event(s) in the same envelope shape
    // (AGENTS.md section 9) - a fresh connection's "snapshot" plus every
    // later "event" feed the same listeners.
    if (payload.type === 'event') {
      eventListeners.forEach((listener) => listener(payload.event))
    } else if (payload.type === 'snapshot') {
      payload.events.forEach((entry) => eventListeners.forEach((listener) => listener(entry.event)))
    }
  })

  socket.addEventListener('close', () => {
    setConnected(false)
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS)
  })

  // The 'close' handler above already schedules the reconnect - just make
  // sure a connection error actually closes the socket instead of hanging.
  socket.addEventListener('error', () => socket.close())
}

function ensureConnected() {
  if (!socket) connect()
}

/** Subscribes to every live device event. Returns an unsubscribe function. */
export function subscribeToLiveEvents(listener) {
  ensureConnected()
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

/** Subscribes to connect/disconnect transitions - fires once immediately with the current state. */
export function subscribeToLiveStatus(listener) {
  ensureConnected()
  listener(connected)
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}
