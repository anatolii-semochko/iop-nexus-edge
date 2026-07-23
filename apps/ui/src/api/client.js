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
    throw new Error(`API ${options.method ?? 'GET'} ${path} failed: ${res.status} ${text}`)
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
  writeResource: (id, resource, value) =>
    request(`/devices/${id}/resources/${resource}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
}
