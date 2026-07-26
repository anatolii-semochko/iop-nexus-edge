// WEM (Warnings/Errors/Messages) service (AGENTS.md section 22) - a
// process's notifications, layered alongside its existing `critical`/
// `warning` Redis flags (processRegistry.ts), not a replacement for them.

import { publishProcessEvent } from "./messaging.js";
import { pool } from "./db.js";

export type MessageType = "warning" | "error" | "message";

export interface ProcessMessage {
  id: number;
  process_id: number;
  type: MessageType;
  level: number;
  code: string;
  text: string;
  hidden: boolean;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageInput {
  code: string;
  level: number;
  text: string;
}

// See `syncActiveMessages`'s `autoResolve` param below.
export type AutoResolveMode = "always" | "when-hidden" | "never";

// Order a process's active messages should render in - errors first, then
// warnings, then plain messages; highest level (most severe) first within
// each, oldest-first as a tiebreak so a longer-running issue sits above
// one that just started.
const TYPE_RANK: Record<MessageType, number> = { error: 0, warning: 1, message: 2 };

/**
 * The shared dedup/reconciliation mechanism (AGENTS.md section 22, "step
 * 4" of the original request) - a process calls this once per tick (or
 * whenever it re-evaluates) with the *complete current set* of `code`s it
 * considers active for one `type`, not just newly-appearing ones. Diffs
 * that against what's already active in the DB:
 * - a `code` that's newly active gets INSERTed (`resolved_at` null);
 * - a `code` that's still active gets its `text`/`level` refreshed in
 *   place (a live reading changes, e.g. "CPU at 90%" -> "CPU at 95%",
 *   without that counting as a new occurrence - same underlying issue);
 * - a `code` that *was* active but isn't in this call's list anymore gets
 *   `resolved_at` set to now (the condition cleared) - **except for type
 *   "message"**, which has no ongoing condition to clear in the first
 *   place (unlike a warning/error tied to a threshold, a message is a
 *   one-shot notification - "CPU at 92%" stops being true the moment
 *   conditions change, but "backup completed at 03:00" doesn't become
 *   false later). A message only ever leaves the active list via
 *   setHidden - the user reading and dismissing it, not the producer
 *   silently dropping its code from a later call.
 *
 * This - not a plain equality check like setCritical/setWarning use for
 * their single boolean - is what "avoid re-sending an unchanged message"
 * means for a *set* of possibly-many concurrent conditions: a boolean
 * only has two states to compare, this has to diff two code sets. Only
 * publishes (the process's complete active list, across every type, since
 * that's what the UI's WEM row renders as one unit) when something in
 * this diff actually changed - an entry with identical level/text to what
 * was already active is a genuine no-op, same principle as setCritical.
 *
 * `autoResolve` - whether a code missing from this call's `entries` means
 * "the condition cleared" (see above). Defaults to `"always"` for
 * warning/error and `"never"` for `message`, i.e. the original assumption
 * that only warning/error are ongoing conditions and `message` is always
 * a one-shot event with nothing to resolve.
 *
 * That assumption doesn't hold for every `message` producer though - e.g.
 * resourceMonitor's Disk notice re-evaluates and re-asserts its code
 * every tick just like a warning/error does, it's rendered as `type:
 * "message"` only to get the dismiss button (AGENTS.md section 22), not
 * because it's a true one-shot. Such callers pass `"when-hidden"`: a
 * *dismissed* row resolves once its condition clears, so a *later*
 * re-trigger starts a fresh (undismissed) row instead of silently
 * rewriting the old, still-hidden one in place - but a row the user
 * hasn't dismissed yet stays active and visible even after its condition
 * clears, exactly like rule 1's "message: visible until the user closes
 * it" says, instead of vanishing on its own the instant the reading drops
 * back under threshold. `"always"` would violate that (a still-visible
 * message auto-disappearing with no user action); `"never"` would
 * reintroduce the original "dismissed message never comes back" bug -
 * `"when-hidden"` is what makes both rules hold at once.
 */
export async function syncActiveMessages(
  processId: number,
  type: MessageType,
  entries: MessageInput[],
  source: string,
  autoResolve: AutoResolveMode = type !== "message" ? "always" : "never",
): Promise<void> {
  const client = await pool.connect();
  let changed = false;
  try {
    await client.query("BEGIN");

    const { rows: active } = await client.query<{
      id: number;
      code: string;
      level: number;
      text: string;
      hidden: boolean;
    }>(
      `SELECT id, code, level, text, hidden FROM process_messages WHERE process_id = $1 AND type = $2 AND resolved_at IS NULL`,
      [processId, type],
    );
    const activeByCode = new Map(active.map((row) => [row.code, row]));
    const incomingCodes = new Set(entries.map((entry) => entry.code));

    for (const entry of entries) {
      const existing = activeByCode.get(entry.code);
      if (existing) {
        if (existing.level !== entry.level || existing.text !== entry.text) {
          await client.query(`UPDATE process_messages SET level = $1, text = $2, updated_at = now() WHERE id = $3`, [
            entry.level,
            entry.text,
            existing.id,
          ]);
          changed = true;
        }
      } else {
        await client.query(
          `INSERT INTO process_messages (process_id, type, level, code, text)
           VALUES ($1, $2, $3, $4, $5)`,
          [processId, type, entry.level, entry.code, entry.text],
        );
        changed = true;
      }
    }

    if (autoResolve !== "never") {
      for (const row of active) {
        if (!incomingCodes.has(row.code) && (autoResolve === "always" || row.hidden)) {
          await client.query(`UPDATE process_messages SET resolved_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
          changed = true;
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (changed) {
    const activeMessages = await listActiveMessages(processId);
    await publishProcessEvent({
      domain: "process",
      entityId: processId,
      field: "messages",
      value: activeMessages,
      timestamp: new Date().toISOString(),
      source,
    });
  }

  // Dashboard tab (AGENTS.md section 22) - unconditional, not gated behind
  // `changed` above: cheap (one indexed EXISTS check) and simplest to just
  // always check rather than reason about which specific diffs could have
  // newly created the process's first-ever active row.
  await maybeFlagForDashboard(processId);
}

// True the moment a process has *any* active (unresolved) entry, of any
// type, regardless of `hidden` - deliberately not `listActiveMessages`
// (which excludes hidden rows for *display* purposes). The Dashboard flag/
// unflag rule cares about the underlying condition, not whether a user has
// hidden its notification.
export async function hasActiveEntries(processId: number): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM process_messages WHERE process_id = $1 AND resolved_at IS NULL) AS exists`,
    [processId],
  );
  return rows[0].exists;
}

// Flags a process for the Dashboard tab the instant it gets its first-ever
// active WEM entry - stays flagged (see routes/processes.ts's dashboard-flag
// DELETE endpoint) until a user explicitly clears it, and only once it's
// back to zero active entries. Idempotent/no-op once already flagged - the
// `dashboard_flagged_at IS NULL` guard is what makes this safe to call on
// every sync rather than only on a genuinely new occurrence.
async function maybeFlagForDashboard(processId: number): Promise<void> {
  await pool.query(
    `UPDATE processes
     SET dashboard_flagged_at = now()
     WHERE id = $1
       AND dashboard_flagged_at IS NULL
       AND EXISTS (SELECT 1 FROM process_messages WHERE process_id = $1 AND resolved_at IS NULL)`,
    [processId],
  );
}

// Active and not dismissed - what the UI's expandable WEM row shows.
// Hidden ones are excluded here rather than left to the caller to filter,
// since "hidden" exists specifically so a dismissed message stops
// appearing, resolved or not.
export async function listActiveMessages(processId: number): Promise<ProcessMessage[]> {
  const { rows } = await pool.query<ProcessMessage>(
    `SELECT * FROM process_messages WHERE process_id = $1 AND resolved_at IS NULL AND hidden = false`,
    [processId],
  );
  // `created_at` comes back from `pg` as a Date, not the `string` its own
  // type says (no custom type parser is registered for timestamptz) - a
  // plain `.localeCompare` here throws the moment two active entries tie
  // on type+level and this tiebreak actually runs, which single-message
  // testing never exercises. Comparing via `Date` works for either shape.
  return rows.sort(
    (a, b) =>
      TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
      b.level - a.level ||
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

// Thrown by setHidden when asked to dismiss a message whose type doesn't
// support it - see the "hidden" rule below.
export class MessageNotDismissableError extends Error {}

// UI-driven, unlike syncActiveMessages above - still publishes the same
// "messages" event afterward so every viewer's WEM row updates immediately
// (a dismiss changes what listActiveMessages returns, same as a resolve).
//
// Only `type: "message"` may be dismissed - an error/warning is tied to a
// live condition and stays visible for as long as that condition holds
// (it leaves the active list on its own once resolved, via
// syncActiveMessages), with no user-facing way to hide it early. Checked
// here, not just left to the UI omitting the dismiss button, so a stray
// API call can't hide an active error/warning either.
export async function setHidden(messageId: number, hidden: boolean): Promise<void> {
  if (hidden) {
    const { rows: typeRows } = await pool.query<{ type: MessageType }>(
      `SELECT type FROM process_messages WHERE id = $1`,
      [messageId],
    );
    const type = typeRows[0]?.type;
    if (type !== undefined && type !== "message") {
      throw new MessageNotDismissableError(`type "${type}" entries cannot be dismissed`);
    }
  }

  const { rows } = await pool.query<{ process_id: number }>(
    `UPDATE process_messages SET hidden = $1, updated_at = now() WHERE id = $2 RETURNING process_id`,
    [hidden, messageId],
  );
  const processId = rows[0]?.process_id;
  if (processId === undefined) return;

  const activeMessages = await listActiveMessages(processId);
  await publishProcessEvent({
    domain: "process",
    entityId: processId,
    field: "messages",
    value: activeMessages,
    timestamp: new Date().toISOString(),
    source: "api",
  });
}
