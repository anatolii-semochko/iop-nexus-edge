// Thin Devices API client - the orchestrator's only way of reaching
// Postgres/Redis/EdgeX-backed state (AGENTS.md section 4/10). Not a general
// SDK, just the handful of calls the process tick loop needs.

import { config } from "./config.js";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    headers: options.body ? { "Content-Type": "application/json" } : {},
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Devices API ${options.method ?? "GET"} ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export interface ProcessRecord {
  id: number;
  name: string;
  type: "controllable" | "permanent";
  kind: string;
  device_id: number | null;
  config: {
    min?: number;
    max?: number;
    // resource-monitor thresholds (AGENTS.md section 21), percentages. 0 or
    // undefined means "don't check this metric".
    cpuMax?: number;
    ramMax?: number;
    diskMax?: number;
    cpuWarnMax?: number;
    ramWarnMax?: number;
    diskWarnMax?: number;
  };
  status?: "on" | "off";
}

export interface ProcessMetrics {
  cpu: number;
  ram: number;
  disk: number;
}

export type MessageType = "warning" | "error" | "message";

export interface MessageInput {
  code: string;
  level: number;
  text: string;
}

// Mirrors processMessages.AutoResolveMode (apps/api) - see
// syncActiveMessages there for what each mode means.
export type AutoResolveMode = "always" | "when-hidden" | "never";

export interface DeviceReading {
  value: unknown;
}

export interface DeviceRecord {
  id: number;
  resources: Record<string, DeviceReading | null>;
}

export const apiClient = {
  listProcesses: () => request<ProcessRecord[]>("/processes"),
  getDevice: (deviceId: number) => request<DeviceRecord>(`/devices/${deviceId}`),
  // Orchestrator-driven write - only reaches EdgeX while the resource is
  // still AUTO (AGENTS.md section 6); always records the intended value
  // even while a human has it overridden MANUAL via the UI.
  setResourceAuto: (deviceId: number, resource: string, value: unknown) =>
    request(`/devices/${deviceId}/resources/${resource}/auto`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  setCritical: (processId: number, critical: boolean) =>
    request(`/processes/${processId}/critical`, {
      method: "POST",
      body: JSON.stringify({ critical }),
    }),
  setMetrics: (processId: number, metrics: ProcessMetrics) =>
    request(`/processes/${processId}/metrics`, {
      method: "POST",
      body: JSON.stringify(metrics),
    }),
  setWarning: (processId: number, warning: boolean) =>
    request(`/processes/${processId}/warning`, {
      method: "POST",
      body: JSON.stringify({ warning }),
    }),
  // WEM (AGENTS.md section 22) - `entries` must be the *complete current
  // set* of codes this process considers active for `type`, not just new
  // ones; the API reconciles that against what's already active (dedup,
  // resolve what's missing) - see processMessages.syncActiveMessages.
  // `autoResolve` defaults server-side to `"always"`/`"never"` (by type)
  // when omitted - only pass it explicitly for a `type: "message"` call
  // whose producer re-asserts its code every tick like a warning/error
  // would (see processMessages.syncActiveMessages's own doc comment for
  // what each mode does), not for a genuine one-shot notification.
  syncMessages: (processId: number, type: MessageType, entries: MessageInput[], autoResolve?: AutoResolveMode) =>
    request(`/processes/${processId}/messages`, {
      method: "POST",
      body: JSON.stringify({ type, entries, autoResolve }),
    }),
};
