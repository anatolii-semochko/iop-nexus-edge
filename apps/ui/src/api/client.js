/**
 * Devices API client.
 *
 * Calls are made against the relative `/api` path, not an absolute host:port -
 * the UI is served by nginx, which reverse-proxies `/api/*` to the `api`
 * service (see apps/ui/nginx.conf.template). This keeps the browser same-origin
 * (no CORS) and independent of whatever host/port the api container is
 * actually mapped to.
 */
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    let message = `API ${options.method ?? 'GET'} ${path} failed: ${res.status} ${text}`
    try {
      const body = JSON.parse(text)
      message = body.reason ?? body.error ?? message
    } catch {
      // response wasn't JSON - keep the raw-text message above
    }
    throw new Error(message)
  }
  if (res.status === 204) {
    return null
  }
  return res.json()
}

export const api = {
  listNodes: () => request('/nodes'),
  getNode: (id) => request(`/nodes/${id}`),
  listDevices: () => request('/devices'),
  getDevice: (id) => request(`/devices/${id}`),
  // A UI write is always a manual override (Dual Devices Model MANUAL mode
  // - see AGENTS.md section 6).
  writeResource: (id, resource, value) =>
    request(`/devices/${id}/resources/${resource}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  // Releases a resource from MANUAL back to AUTO - the orchestrator's last
  // computed value takes over immediately.
  releaseResource: (id, resource) =>
    request(`/devices/${id}/resources/${resource}/release`, { method: 'POST' }),
  getSystemMode: () => request('/system/mode'),
}
