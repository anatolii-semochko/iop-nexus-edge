import { Pool, types } from "pg";

import { config } from "./config.js";

// Postgres returns `numeric` columns as strings by default (pg avoids
// silent float precision loss on values too big for a JS number) -
// message_levels.repeat_seconds and message_signal_timing's beep-timing
// columns (AGENTS_TO_DO.md, 2026-08-01 beep-count/repeat-seconds redesign)
// are the first `numeric` columns in this schema, and every consumer
// (alarmPolicy.ts, activeBuzzer.ts, apps/ui's number inputs) expects a
// real JS number - these are small human-entered second counts, never
// large enough for float precision loss to matter in practice.
types.setTypeParser(1700, (value) => parseFloat(value));

export const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
});
