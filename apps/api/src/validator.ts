// Model State Validator (see AGENTS.md section 6): an in-process check,
// not a separate service, that rejects a write which would put a device
// into a forbidden combined state (e.g. heating and cooling active at
// once) - it never crosses a network hop beyond the EdgeX reads it already
// needs to know the device's *other* current resource values.
//
// Rules are declared per device in `devices.capabilities.forbidden`
// (Postgres) - see apps/api/migrations. There is no cross-device rule
// support yet (that needs the Redis-backed Dual Devices Model state, which
// doesn't exist yet either - see the Implementation status note in
// AGENTS.md section 7); today a rule only ever compares resources on the
// same device.

export interface ForbiddenRule {
  when: { resource: string; equals: unknown };
  conflictsWith: { resource: string; equals: unknown };
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** Every resource name a set of rules needs the *current* value of, other
 * than the one about to be written (whose new value is already known). */
export function resourcesNeededFor(rules: ForbiddenRule[], writtenResource: string): string[] {
  const names = new Set<string>();
  for (const rule of rules) {
    names.add(rule.when.resource);
    names.add(rule.conflictsWith.resource);
  }
  names.delete(writtenResource);
  return [...names];
}

/** currentValues must contain every resource resourcesNeededFor() returned,
 * except the one being written (its new value comes from `value`). */
export function validateWrite(
  rules: ForbiddenRule[],
  writtenResource: string,
  value: unknown,
  currentValues: Record<string, unknown>,
): ValidationResult {
  const afterValues = { ...currentValues, [writtenResource]: value };

  for (const rule of rules) {
    const matches = (resource: string, expected: unknown) => String(afterValues[resource]) === String(expected);

    if (matches(rule.when.resource, rule.when.equals) && matches(rule.conflictsWith.resource, rule.conflictsWith.equals)) {
      return {
        ok: false,
        reason:
          `writing ${writtenResource}=${value} would leave ${rule.when.resource}=${rule.when.equals} ` +
          `and ${rule.conflictsWith.resource}=${rule.conflictsWith.equals} active at the same time, ` +
          "which is a forbidden combined state",
      };
    }
  }

  return { ok: true };
}
