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
  // FormData (avatar upload) needs the browser to set its own multipart
  // boundary in Content-Type - never set it ourselves for that case.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData
  const res = await fetch(`${BASE}${path}`, {
    // Only set Content-Type when there's actually a JSON body - Fastify's
    // default JSON parser rejects an empty body sent with this header
    // (FST_ERR_CTP_EMPTY_JSON_BODY), which bodyless requests like
    // releaseResource below otherwise trigger. Cookies (the session - see
    // AGENTS.md section 13) ride along automatically since this is always a
    // same-origin request, no explicit `credentials` option needed.
    headers: options.body && !isFormData ? { 'Content-Type': 'application/json' } : {},
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
  // Processes (AGENTS.md section 10 - orchestration).
  listProcesses: () => request('/processes'),
  setProcessConfig: (id, config) =>
    request(`/processes/${id}/config`, { method: 'PATCH', body: JSON.stringify(config) }),
  doProcessAction: (id, action) =>
    request(`/processes/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
  // WEM (AGENTS.md section 22) - global dismiss, not per-user.
  hideMessage: (messageId) =>
    request(`/process-messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }),
  // Process groups (AGENTS.md section 10/17 - a real, admin-managed entity).
  listProcessGroups: () => request('/process-groups'),
  createProcessGroup: (name) =>
    request('/process-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameProcessGroup: (id, name) =>
    request(`/process-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProcessGroup: (id) => request(`/process-groups/${id}`, { method: 'DELETE' }),
  // Auth (AGENTS.md section 13 - UI login only, not per-endpoint API
  // authorization).
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getCurrentUser: () => request('/auth/me'),
  // User management (admin-only server-side - see apps/api/src/routes/users.ts).
  listUsers: () => request('/users'),
  getUser: (id) => request(`/users/${id}`),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  uploadAvatar: (id, file) => {
    const formData = new FormData()
    formData.append('avatar', file)
    return request(`/users/${id}/avatar`, { method: 'POST', body: formData })
  },
  deleteAvatar: (id) => request(`/users/${id}/avatar`, { method: 'DELETE' }),
}
