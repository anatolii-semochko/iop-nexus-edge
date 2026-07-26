// First real test file in the repo (AGENTS.md's refactoring notes,
// to-do.txt Etap 1/Fаза 0) - starts with determineAlarmPlan specifically
// because it's pure (no I/O) and sits directly on the class of bug this
// codebase has hit repeatedly (silent priority/precedence mistakes), not
// because it's the only thing that could be tested.

import { describe, expect, it } from "vitest";

import { determineAlarmPlan, type MessageLevelConfig } from "./alarmPolicy.js";

const LEVELS: MessageLevelConfig[] = [
  { type: "error", level: 1, mode: "constant", period_deciseconds: 0 },
  { type: "error", level: 2, mode: "shortBeep", period_deciseconds: 5 },
  { type: "error", level: 3, mode: "off", period_deciseconds: 0 },
  { type: "warning", level: 1, mode: "longBeep", period_deciseconds: 200 },
];

describe("determineAlarmPlan", () => {
  it("returns null when nothing is active", () => {
    expect(determineAlarmPlan({}, LEVELS)).toBeNull();
  });

  it("returns the warning config when only warning is active", () => {
    expect(determineAlarmPlan({ warning: [1] }, LEVELS)).toEqual({
      mode: "longBeep",
      periodDeciseconds: 200,
    });
  });

  it("returns the error config when only error is active", () => {
    expect(determineAlarmPlan({ error: [1] }, LEVELS)).toEqual({
      mode: "constant",
      periodDeciseconds: 0,
    });
  });

  it("prefers error over warning when both are active", () => {
    expect(determineAlarmPlan({ error: [1], warning: [1] }, LEVELS)).toEqual({
      mode: "constant",
      periodDeciseconds: 0,
    });
  });

  it("picks the highest active level within the winning type", () => {
    expect(determineAlarmPlan({ error: [1, 2] }, LEVELS)).toEqual({
      mode: "shortBeep",
      periodDeciseconds: 5,
    });
  });

  it("does not fall through to a lower-priority type when the winning level is configured off", () => {
    // error level 3 is "off" and wins on priority - warning stays silenced
    // even though warning/1 itself is configured to sound.
    expect(determineAlarmPlan({ error: [3], warning: [1] }, LEVELS)).toBeNull();
  });

  it("returns null when the winning level has no matching config row", () => {
    expect(determineAlarmPlan({ error: [4] }, LEVELS)).toBeNull();
  });
});
