import type { MigrationBuilder } from "node-pg-migrate";

// Adds CPU/SoC temperature thresholds to the existing Resource Monitor
// process config (AGENTS.md section 21, apps/orchestrator/src/processes/
// resourceMonitor.ts's new readTempCelsius). Same "loose jsonb, merged in"
// pattern as migration ...033 - existing cpuMax/ramMax/diskMax etc. are
// preserved, not overwritten. Unlike those three, tempMax/tempWarnMax are
// degrees Celsius, not a percentage - defaults picked from the Raspberry
// Pi SoC's own documented throttling points (soft throttle ~80C, hard
// throttle steps at 85C), not an arbitrary round number, since this
// project's actual deployment target is a Pi.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config || jsonb_build_object('tempMax', 80, 'tempWarnMax', 70)
    WHERE kind = 'resource-monitor'
  `);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE processes
    SET config = config - 'tempMax' - 'tempWarnMax'
    WHERE kind = 'resource-monitor'
  `);
};
