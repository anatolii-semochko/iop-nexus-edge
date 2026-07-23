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
    // Only set Content-Type when there's actually a body - Fastify's
    // default JSON parser rejects an empty body sent with this header
    // (FST_ERR_CTP_EMPTY_JSON_BODY), which bodyless requests like
    // releaseResource below otherwise trigger.
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
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
  // Dev-only: pushes a new reading for a read-only (sensor) resource,
  // bypassing the Dual Devices Model entirely - simulates the physical
  // device producing a new value on its own (AGENTS.md section 7/9).
  simulateResource: (id, resource, value) =>
    request(`/devices/${id}/resources/${resource}/simulate`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
}
