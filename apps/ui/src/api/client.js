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
    // releaseDevice below otherwise trigger. Cookies (the session - see
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
  // - see AGENTS.md section 6). No `resource` param anymore (to-do.txt's
  // 2026-07-27 Device/Node refactor) - a Device is atomic, exactly one value.
  writeDevice: (id, value) =>
    request(`/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  // Releases a device from MANUAL back to AUTO - the orchestrator's last
  // computed value takes over immediately.
  releaseDevice: (id) => request(`/devices/${id}/release`, { method: 'POST' }),
  getSystemMode: () => request('/system/mode'),
  // Dev-only: pushes a new reading for a read-only (sensor) device,
  // bypassing the Dual Devices Model entirely - simulates the physical
  // device producing a new value on its own (AGENTS.md section 7/9).
  simulateDevice: (id, value) =>
    request(`/devices/${id}/simulate`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  // Processes (AGENTS.md section 10 - orchestration).
  listProcesses: () => request('/processes'),
  setProcessConfig: (id, config) =>
    request(`/processes/${id}/config`, { method: 'PATCH', body: JSON.stringify(config) }),
  doProcessAction: (id, action) =>
    request(`/processes/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
  // WEM (AGENTS.md section 22/25) - global dismiss (who/when is recorded
  // server-side from the session cookie, not sent here). `/log-messages`
  // (renamed from `/process-messages`, to-do.txt's 2026-07-27 Device/Node
  // refactor) backs the underlying `log_messages` table (was
  // `process_messages`).
  hideMessage: (messageId) =>
    request(`/log-messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden: true }),
    }),
  // Notification center (AGENTS.md section 25) - server-side paginated,
  // unlike every other list in this app (section 11). Historical (New/All
  // tabs) only - the Active tab reads live process state instead, never
  // this endpoint. Also reused by the Logs page's processes tab (section
  // 29, `from`/`to` date-range params), which the notification center
  // itself never sets.
  listProcessMessages: ({ type, scope, processId, search, from, to, page, pageSize }) => {
    const params = new URLSearchParams({ type, scope, page, pageSize })
    if (processId) params.set('processId', processId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/log-messages?${params}`)
  },
  // Logs page (AGENTS.md section 29) - commands/devices tabs (renamed from
  // deviceCommands/sensors, to-do.txt's 2026-07-27 Device/Node refactor -
  // matches the renamed log_command/log_device tables). The processes tab
  // reuses listProcessMessages above instead of a third function here.
  listCommandLogs: ({ deviceId, action, search, from, to, page, pageSize }) => {
    const params = new URLSearchParams({ page, pageSize })
    if (deviceId) params.set('deviceId', deviceId)
    if (action) params.set('action', action)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/logs/commands?${params}`)
  },
  listDeviceLogs: ({ deviceId, search, from, to, page, pageSize }) => {
    const params = new URLSearchParams({ page, pageSize })
    if (deviceId) params.set('deviceId', deviceId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/logs/devices?${params}`)
  },
  // Process groups (AGENTS.md section 10/17 - a real, admin-managed entity).
  listProcessGroups: () => request('/process-groups'),
  createProcessGroup: (name) =>
    request('/process-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameProcessGroup: (id, name) =>
    request(`/process-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteProcessGroup: (id) => request(`/process-groups/${id}`, { method: 'DELETE' }),
  // Tab Groups (AGENTS.md section 22) - an operator's own curated
  // workspace, distinct from Process Groups above; admin-managed, ordered,
  // each one a dynamic tab on the Processes page.
  listTabGroups: () => request('/tab-groups'),
  createTabGroup: (name) =>
    request('/tab-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameTabGroup: (id, name) =>
    request(`/tab-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTabGroup: (id) => request(`/tab-groups/${id}`, { method: 'DELETE' }),
  reorderTabGroups: (orderedIds) =>
    request('/tab-groups/reorder', { method: 'PATCH', body: JSON.stringify({ orderedIds }) }),
  // Per-process Tab Group assignment.
  getProcessTabGroups: (id) => request(`/processes/${id}/tab-groups`),
  setProcessTabGroups: (id, tabGroupIds) =>
    request(`/processes/${id}/tab-groups`, {
      method: 'PUT',
      body: JSON.stringify({ tabGroupIds }),
    }),
  // Message Groups (AGENTS.md section 22) - WEM notification routing,
  // distinct from both Process Groups and Tab Groups above - not tied to
  // either, no ordering (nothing here drives a tab).
  listMessageGroups: () => request('/message-groups'),
  createMessageGroup: (name) =>
    request('/message-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameMessageGroup: (id, name) =>
    request(`/message-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteMessageGroup: (id) => request(`/message-groups/${id}`, { method: 'DELETE' }),
  // Per-process Message Group assignment.
  getProcessMessageGroups: (id) => request(`/processes/${id}/message-groups`),
  setProcessMessageGroups: (id, messageGroupIds) =>
    request(`/processes/${id}/message-groups`, {
      method: 'PUT',
      body: JSON.stringify({ messageGroupIds }),
    }),
  // Message Levels (AGENTS.md section 22) - fixed 8-row matrix, only
  // mode/period are ever edited.
  listMessageLevels: () => request('/message-levels'),
  updateMessageLevel: (type, level, mode, periodDeciseconds) =>
    request(`/message-levels/${type}/${level}`, {
      method: 'PATCH',
      body: JSON.stringify({ mode, periodDeciseconds }),
    }),
  // Dashboard tab (AGENTS.md section 22) - clears the flag; the API 400s
  // if the process still has active WEM entries.
  clearDashboardFlag: (id) => request(`/processes/${id}/dashboard-flag`, { method: 'DELETE' }),
  // Heartbeating Control (AGENTS.md) - one mixed list across processes/
  // devices/nodes, one update path parameterized by `type` regardless of
  // which table it actually writes to.
  listHeartbeatControls: () => request('/heartbeat-controls'),
  updateHeartbeatControl: (type, id, { warning, error }) =>
    request(`/heartbeat-controls/${type}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ warning, error }),
    }),
  setHeartbeatStopped: (type, id, stopped) =>
    request(`/heartbeat-controls/${type}/${id}/stopped`, {
      method: 'PUT',
      body: JSON.stringify({ stopped }),
    }),
  // "heartbeat-control-test" kind only - its own bespoke internal flag,
  // deliberately not the generic doProcessAction ON/OFF (AGENTS.md's
  // Heartbeating Control section - that field is timer-only/non-urgent
  // and visibly lagged for this exact use case).
  setHeartbeatTestFailure: (id, simulate) =>
    request(`/processes/${id}/heartbeat-test-failure`, {
      method: 'PUT',
      body: JSON.stringify({ simulate }),
    }),
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
