import type { ProcessRecord } from "./apiClient.js";

export type ProcessRunner = (process: ProcessRecord) => Promise<void>;

const runners = new Map<string, ProcessRunner>();

/**
 * process.kind -> its control-loop function (AGENTS.md section 10).
 * Built-in kinds (see index.ts) register through this exact same
 * register() a target-project plugin would use - extension points
 * design, AGENTS_TO_DO.md 2026-07-28 - no special-casing for "official" kinds.
 */
export const processRegistry = {
  register(kind: string, runner: ProcessRunner): void {
    if (runners.has(kind)) {
      throw new Error(`process kind "${kind}" is already registered`);
    }
    runners.set(kind, runner);
  },
  get(kind: string): ProcessRunner | undefined {
    return runners.get(kind);
  },
  // Currently-loaded kind names (AGENTS_TO_DO.md, 2026-08-14 process
  // management) - exposed via GET /process-kinds so apps/api/UI can tell
  // a `processes` row whose kind was just added to the Postgres table
  // apart from one whose plugin code is actually loaded in this running
  // orchestrator (the latter only happens at startup - processPlugins.ts's
  // own loadProcessPlugins() runs once, not on a timer).
  list(): string[] {
    return [...runners.keys()];
  },
};
