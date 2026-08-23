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
  // A Node is a physical workplace served by exactly one group of Nodes
  // (AGENTS_TO_DO.md, 2026-08-01) - single assignment, from this Node's
  // own per-row Settings popup.
  setNodeGroup: (id, groupId) =>
    request(`/nodes/${id}/group`, { method: 'PATCH', body: JSON.stringify({ groupId }) }),
  renameNode: (id, name) =>
    request(`/nodes/${id}/name`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  setNodeLocation: (id, location) =>
    request(`/nodes/${id}/location`, { method: 'PATCH', body: JSON.stringify({ location }) }),
  // Partial physical network (AGENTS_TO_DO.md, 2026-08-09/10) - a node
  // switches every attached device's EdgeX redirect at once.
  setNodeSimulated: (id, simulated) =>
    request(`/nodes/${id}/simulated`, { method: 'PATCH', body: JSON.stringify({ simulated }) }),
  listDevices: () => request('/devices'),
  getDevice: (id) => request(`/devices/${id}`),
  // Per-device Device Group membership (multiple at once - shared devices
  // like a siren in both a "fire" and "intrusion" group) plus this
  // device's Node assignment (single, nullable) - both edited together
  // from the same per-device Settings popup (AGENTS_TO_DO.md, 2026-08-01).
  getDeviceGroups: (id) => request(`/devices/${id}/device-groups`),
  setDeviceGroups: (id, deviceGroupIds) =>
    request(`/devices/${id}/device-groups`, {
      method: 'PUT',
      body: JSON.stringify({ deviceGroupIds }),
    }),
  setDeviceNode: (id, nodeId) =>
    request(`/devices/${id}/node`, { method: 'PATCH', body: JSON.stringify({ nodeId }) }),
  renameDevice: (id, name) =>
    request(`/devices/${id}/name`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  // Same as setNodeSimulated above, for a standalone device (no node) -
  // rejected server-side for a node-attached one (toggle the node
  // instead).
  setDeviceSimulated: (id, simulated) =>
    request(`/devices/${id}/simulated`, { method: 'PATCH', body: JSON.stringify({ simulated }) }),
  // UI redesign (AGENTS_TO_DO.md, 2026-08-14) - partial merge onto
  // device.capabilities (color/physicalId for now, generic for any
  // future key).
  setDeviceCapabilities: (id, patch) =>
    request(`/devices/${id}/capabilities`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // A UI write is always a manual override (Dual Devices Model MANUAL mode
  // - see AGENTS.md section 6). No `resource` param anymore (AGENTS_TO_DO.md's
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
  // Process management (AGENTS_TO_DO.md, 2026-08-14) - live create/delete,
  // plus which kinds the running orchestrator actually has loaded right
  // now (a row whose kind isn't in this list needs an orchestrator
  // restart before it does anything - see ProcessesList.jsx's own
  // "pending restart" badge).
  createProcess: (data) => request('/processes', { method: 'POST', body: JSON.stringify(data) }),
  deleteProcess: (id) => request(`/processes/${id}`, { method: 'DELETE' }),
  getRegisteredProcessKinds: () => request('/processes/registered-kinds'),
  // WEM (AGENTS.md section 22/25) - global dismiss (who/when is recorded
  // server-side from the session cookie, not sent here). `/log-messages`
  // (renamed from `/process-messages`, AGENTS_TO_DO.md's 2026-07-27 Device/Node
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
  // deviceCommands/sensors, AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor -
  // matches the renamed log_command/log_device tables). The processes tab
  // reuses listProcessMessages above instead of a third function here.
  listCommandLogs: ({ deviceId, action, actorUserId, search, from, to, page, pageSize }) => {
    const params = new URLSearchParams({ page, pageSize })
    if (deviceId) params.set('deviceId', deviceId)
    if (action) params.set('action', action)
    if (actorUserId) params.set('actorUserId', actorUserId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/logs/commands?${params}`)
  },
  // Minimal user listing (AGENTS_TO_DO.md, 2026-08-01) - not admin-gated
  // like listUsers() below, for the Commands tab's actor filter.
  listUserDirectory: () => request('/users/directory'),
  listDeviceLogs: ({ deviceId, search, from, to, page, pageSize }) => {
    const params = new URLSearchParams({ page, pageSize })
    if (deviceId) params.set('deviceId', deviceId)
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return request(`/logs/devices?${params}`)
  },
  // Node Groups (AGENTS_TO_DO.md, 2026-08-01) - logical/business groups
  // for Nodes (heating, ventilation, lighting, garage...); single-FK, like
  // Process Groups below - a Node belongs to at most one at a time.
  listNodeGroups: () => request('/node-groups'),
  createNodeGroup: (name) =>
    request('/node-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameNodeGroup: (id, name) =>
    request(`/node-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteNodeGroup: (id) => request(`/node-groups/${id}`, { method: 'DELETE' }),
  // Device Groups (AGENTS_TO_DO.md, 2026-08-01) - logical/business groups
  // for Devices (entrance guard panel, boiler room boiler...); many-to-
  // many, like Tab/Message Groups below - a Device can be in several at
  // once.
  listDeviceGroups: () => request('/device-groups'),
  createDeviceGroup: (name) =>
    request('/device-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameDeviceGroup: (id, name) =>
    request(`/device-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteDeviceGroup: (id) => request(`/device-groups/${id}`, { method: 'DELETE' }),
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
  // Message Levels (AGENTS.md section 22, beep-count/repeat-seconds
  // redesign AGENTS_TO_DO.md 2026-08-01) - fixed 8-row matrix, only
  // mode/beepCount/repeatSeconds are ever edited.
  listMessageLevels: () => request('/message-levels'),
  updateMessageLevel: (type, level, mode, beepCount, repeatSeconds) =>
    request(`/message-levels/${type}/${level}`, {
      method: 'PATCH',
      body: JSON.stringify({ mode, beepCount, repeatSeconds }),
    }),
  // The beep-pattern timing profile shared by every level/type (singleton
  // row) - to the right of Message Levels in Settings.
  getMessageSignalTiming: () => request('/message-signal-timing'),
  updateMessageSignalTiming: (patch) =>
    request('/message-signal-timing', { method: 'PATCH', body: JSON.stringify(patch) }),
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
  // Data Logger (AGENTS.md) - Devices-only list (unlike Heartbeating
  // Control's three-type merge, a Node has no value to log), plus the
  // process's own two global switches (settings, singleton - not
  // per-device).
  listDataLoggerControls: () => request('/data-logger-controls'),
  getDataLoggerSettings: () => request('/data-logger-controls/settings'),
  updateDataLoggerSettings: (patch) =>
    request('/data-logger-controls/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  updateDataLoggerControl: (deviceId, { periodSeconds, warning, error }) =>
    request(`/data-logger-controls/${deviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ periodSeconds, warning, error }),
    }),
  setDataLoggerWriteEnabled: (deviceId, writeEnabled) =>
    request(`/data-logger-controls/${deviceId}/write-enabled`, {
      method: 'PUT',
      body: JSON.stringify({ writeEnabled }),
    }),
  // Library Catalog (AGENTS.md) - read-only browser over devices/'s
  // design-time layout; categoryId omitted means the root of `kind`'s own
  // tree (device and node are two independent trees).
  browseLibrary: (kind, categoryId) =>
    request(`/library/browse?kind=${kind}${categoryId ? `&categoryId=${categoryId}` : ''}`),
  searchLibrary: (kind, q) => request(`/library/search?kind=${kind}&q=${encodeURIComponent(q)}`),
  syncLibrary: () => request('/library/sync', { method: 'POST' }),
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
