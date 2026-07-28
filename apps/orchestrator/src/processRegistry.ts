import type { ProcessRecord } from "./apiClient.js";

export type ProcessRunner = (process: ProcessRecord) => Promise<void>;

const runners = new Map<string, ProcessRunner>();

/**
 * process.kind -> its control-loop function (AGENTS.md section 10).
 * Built-in kinds (see index.ts) register through this exact same
 * register() a target-project plugin would use - extension points
 * design, to-do.txt 2026-07-28 - no special-casing for "official" kinds.
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
};
