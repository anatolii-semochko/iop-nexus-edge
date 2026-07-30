// Model State Validator (see AGENTS.md section 6): an in-process check,
// not a separate service, that rejects a write which would put a Node's
// devices into a forbidden combined state (e.g. a heater and a cooler
// active at once) - it never crosses a network hop beyond the EdgeX reads
// it already needs to know the node's *other* devices' current values.
//
// Rules are declared per node in `nodes.forbidden` (Postgres) - see
// apps/api/migrations. Scoped to a Node, not a Device, since a Device is
// atomic now (AGENTS_TO_DO.md's 2026-07-27 Device/Node refactor) - a rule like
// "Heater and Cooler must never both be active" is a property of the
// physical assembly they're both mounted on, not of either Device in
// isolation. `device` here is a device *name*, resolved within the same
// node as the device being written - there is no cross-node rule support
// (nor a need for one: two devices on different nodes have no physical
// coupling to protect against).

export interface ForbiddenRule {
  when: { device: string; equals: unknown };
  conflictsWith: { device: string; equals: unknown };
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** Every device name a set of rules needs the *current* value of, other
 * than the one about to be written (whose new value is already known). */
export function devicesNeededFor(rules: ForbiddenRule[], writtenDevice: string): string[] {
  const names = new Set<string>();
  for (const rule of rules) {
    names.add(rule.when.device);
    names.add(rule.conflictsWith.device);
  }
  names.delete(writtenDevice);
  return [...names];
}

/** currentValues must contain every device devicesNeededFor() returned,
 * except the one being written (its new value comes from `value`). */
export function validateWrite(
  rules: ForbiddenRule[],
  writtenDevice: string,
  value: unknown,
  currentValues: Record<string, unknown>,
): ValidationResult {
  const afterValues = { ...currentValues, [writtenDevice]: value };

  for (const rule of rules) {
    const matches = (device: string, expected: unknown) => String(afterValues[device]) === String(expected);

    if (matches(rule.when.device, rule.when.equals) && matches(rule.conflictsWith.device, rule.conflictsWith.equals)) {
      return {
        ok: false,
        reason:
          `writing ${writtenDevice}=${value} would leave ${rule.when.device}=${rule.when.equals} ` +
          `and ${rule.conflictsWith.device}=${rule.conflictsWith.equals} active at the same time, ` +
          "which is a forbidden combined state",
      };
    }
  }

  return { ok: true };
}
