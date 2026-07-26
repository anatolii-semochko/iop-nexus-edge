// Shared alarm-priority policy (AGENTS.md's Active Zummer section) - given
// which WEM severities are currently active fleet-wide and the admin's
// per-(type, level) Message Levels config (apps/api's message_levels
// table), decides what a sound-output device should be doing right now.
// Not itself device-specific - any future sound-output process (the
// user's own stated direction: more than one eventually, some
// controllable, some not) reuses this instead of re-deriving the same
// priority/lookup logic.

export type AlarmLevelType = "error" | "warning";

// error always wins over warning today - confirmed with the user, who
// explicitly said priority handling will grow later (more types, and real
// per-producer levels beyond the placeholder "1" every kind sends today -
// see apps/api/src/processMessages.ts's own comment on that). An ordered
// array, not a hardcoded if/else, so extending this later is a one-line
// change here, not a rewrite of every caller.
export const ALARM_TYPE_PRIORITY: AlarmLevelType[] = ["error", "warning"];

export type AlarmMode = "off" | "constant" | "shortBeep" | "longBeep";

// Mirrors apps/api's message_levels row shape exactly (snake_case
// `period_deciseconds`, as `GET /message-levels` actually returns it - no
// camelCase transform happens server-side for reads, only the PATCH body
// accepts camelCase).
export interface MessageLevelConfig {
  type: AlarmLevelType;
  level: number;
  mode: AlarmMode;
  period_deciseconds: number;
}

export interface AlarmPlan {
  mode: "constant" | "shortBeep" | "longBeep";
  periodDeciseconds: number;
}

/**
 * `activeLevelsByType[type]` is every currently-active level number for
 * that type, fleet-wide. The caller decides how to gather that safely -
 * see apps/orchestrator/src/processes/activeBuzzer.ts, which deliberately
 * derives this from the existing unfiltered `critical`/`warning` flags,
 * NOT from any process's `messages` array. `messages` excludes entries a
 * user has hidden (dismissed) in the notification center - a dismissed
 * notification must never silence a still-active physical alarm, since
 * dismissing only means "I've seen it", not "the condition cleared".
 *
 * Picks the highest-priority type (`ALARM_TYPE_PRIORITY`) that has at
 * least one active level, then the *highest* active level within it (most
 * severe), and looks up that exact (type, level)'s configured mode/period.
 * A configured `"off"` at the winning type/level stops here - it does
 * *not* fall through to a lower-priority type, since the higher-priority
 * condition is still genuinely active; the admin simply chose not to
 * sound for it. Returns `null` when nothing is active at all, the winning
 * entry has no matching config row, or its mode is `"off"`.
 */
export function determineAlarmPlan(
  activeLevelsByType: Partial<Record<AlarmLevelType, number[]>>,
  messageLevels: MessageLevelConfig[],
): AlarmPlan | null {
  for (const type of ALARM_TYPE_PRIORITY) {
    const levels = activeLevelsByType[type];
    if (!levels || levels.length === 0) continue;

    const maxLevel = Math.max(...levels);
    const config = messageLevels.find((c) => c.type === type && c.level === maxLevel);
    if (!config || config.mode === "off") return null;
    return { mode: config.mode, periodDeciseconds: config.period_deciseconds };
  }
  return null;
}
