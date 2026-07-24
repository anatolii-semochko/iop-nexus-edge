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
  config: { min?: number; max?: number; linkedProcessIds?: number[] };
  status?: "on" | "off";
}

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
};
