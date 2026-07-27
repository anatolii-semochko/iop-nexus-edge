// WEM (Warnings/Errors/Messages) service (AGENTS.md section 22/25) - a
// process's notifications, layered alongside its existing `critical`/
// `warning` Redis flags (processRegistry.ts), not a replacement for them.

import { pool } from "./db.js";
import * as processRegistry from "./processRegistry.js";
import type { ProcessPublicMessage } from "./processRegistry.js";
import { processStateEvents } from "./processStateEvents.js";
import { redis } from "./redis.js";

export type MessageType = "warning" | "error" | "message";

export interface ProcessMessage {
  id: number;
  process_id: number;
  type: MessageType;
  level: number;
  code: string;
  text: string;
  hidden: boolean;
  hidden_by: number | null;
  hidden_at: string | null;
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
  // Urgent (AGENTS.md section 24) only for a brand-new active entry - an
  // UPDATE to an existing row's text/level (a live reading changing) or a
  // resolve is still `changed` for the cache-refresh below, but neither is
  // "new" information the bus needs to push out-of-band ahead of the next
  // periodic broadcast. Counted, not just a boolean - one call can insert
  // more than one new code at once (e.g. two metrics crossing threshold
  // the same tick), and the unread counter (section 25) needs the exact
  // count, not just "at least one".
  let newEntryCount = 0;
  try {
    await client.query("BEGIN");

    const { rows: active } = await client.query<{
      id: number;
      code: string;
      level: number;
      text: string;
      hidden: boolean;
    }>(
      `SELECT id, code, level, text, hidden FROM log_messages WHERE process_id = $1 AND type = $2 AND resolved_at IS NULL`,
      [processId, type],
    );
    const activeByCode = new Map(active.map((row) => [row.code, row]));
    const incomingCodes = new Set(entries.map((entry) => entry.code));

    for (const entry of entries) {
      const existing = activeByCode.get(entry.code);
      if (existing) {
        if (existing.level !== entry.level || existing.text !== entry.text) {
          await client.query(`UPDATE log_messages SET level = $1, text = $2, updated_at = now() WHERE id = $3`, [
            entry.level,
            entry.text,
            existing.id,
          ]);
          changed = true;
        }
      } else {
        await client.query(
          `INSERT INTO log_messages (process_id, type, level, code, text)
           VALUES ($1, $2, $3, $4, $5)`,
          [processId, type, entry.level, entry.code, entry.text],
        );
        changed = true;
        newEntryCount += 1;
      }
    }

    if (autoResolve !== "never") {
      for (const row of active) {
        if (!incomingCodes.has(row.code) && (autoResolve === "always" || row.hidden)) {
          await client.query(`UPDATE log_messages SET resolved_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
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

  if (newEntryCount > 0) {
    await bumpUnreadCount(type, newEntryCount);
  }

  if (changed) {
    const activeMessages = await listActiveMessages(processId);
    await processRegistry.setActiveMessages(processId, toPublicMessages(activeMessages), newEntryCount > 0, source);
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
    `SELECT EXISTS(SELECT 1 FROM log_messages WHERE process_id = $1 AND resolved_at IS NULL) AS exists`,
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
       AND EXISTS (SELECT 1 FROM log_messages WHERE process_id = $1 AND resolved_at IS NULL)`,
    [processId],
  );
}

// Active and not dismissed - what the UI's expandable WEM row shows.
// Hidden ones are excluded here rather than left to the caller to filter,
// since "hidden" exists specifically so a dismissed message stops
// appearing, resolved or not.
export async function listActiveMessages(processId: number): Promise<ProcessMessage[]> {
  const { rows } = await pool.query<ProcessMessage>(
    `SELECT * FROM log_messages WHERE process_id = $1 AND resolved_at IS NULL AND hidden = false`,
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

// Trimmed to what the bus's public-state broadcast actually needs
// (AGENTS.md section 24) - `process_id` is redundant (it's already the key
// this list is nested under) and `resolved_at` is always null for an
// active list by construction, so neither belongs on the wire.
function toPublicMessages(messages: ProcessMessage[]): ProcessPublicMessage[] {
  return messages.map(({ id, type, level, code, text, hidden, created_at, updated_at }) => ({
    id,
    type,
    level,
    code,
    text,
    hidden,
    created_at,
    updated_at,
  }));
}

// UI-driven, unlike syncActiveMessages above - still refreshes the same
// public-state cache afterward (not urgent for the process-row overlay -
// AGENTS.md section 24, a dismiss there is a cosmetic user action - but IS
// urgent for the notification center's unread badge, section 25, since a
// user just acted on it and expects every viewer's badge to reflect that
// immediately, not on the next periodic tick).
//
// The notification center (section 25) reuses this same "hidden" flag as
// its read/unread marker for every type, not just `message` - dismissing
// an entry there is the same act as dismissing it anywhere else, so the
// type restriction that used to live here (only `message` could be
// dismissed) is gone. `apps/ui`'s WemRow.jsx (the process's own detail
// panel) still only ever renders its own dismiss button for `message` -
// that UI surface's intent ("stop showing this on my process card") is
// unchanged; this function no longer enforces it structurally, since
// section 25's notification center needs to dismiss warning/error rows
// too and there is now only one dismiss action in the whole system, not
// two different ones with different rules. `userId` - who did it, `null`
// if the caller has no authenticated identity (kept optional rather than
// required so this function still works from any future non-UI caller).
export async function setHidden(messageId: number, hidden: boolean, userId: number | null): Promise<void> {
  const { rows } = await pool.query<{ process_id: number; type: MessageType }>(
    `UPDATE log_messages
     SET hidden = $1, hidden_by = $2, hidden_at = $3, updated_at = now()
     WHERE id = $4 AND hidden != $1
     RETURNING process_id, type`,
    [hidden, hidden ? userId : null, hidden ? new Date().toISOString() : null, messageId],
  );
  const row = rows[0];
  if (!row) return; // already at this state - no-op, same principle as setCritical/setWarning

  await bumpUnreadCount(row.type, hidden ? -1 : 1);
  processStateEvents.emit("urgent", { reason: "read", messageId, source: "api" });

  const activeMessages = await listActiveMessages(row.process_id);
  await processRegistry.setActiveMessages(row.process_id, toPublicMessages(activeMessages), false, "api");
}

// --- Notification center (AGENTS.md section 25) ---

// Unread counters, one per type - Redis, not a live COUNT(*) on every
// header render (this is read on every fleet broadcast tick, section 24,
// and the whole point of that broadcast is to avoid per-client polling
// hitting Postgres). "Unread" = not yet dismissed, regardless of
// resolved_at - a warning that already cleared before anyone looked still
// counts until someone acknowledges it, same as one still active.
const UNREAD_COUNT_TYPES: MessageType[] = ["message", "warning", "error"];

function unreadCountKey(type: MessageType): string {
  return `wem:unread:${type}`;
}

/** Recomputes every counter from Postgres - call once at boot. Redis is
 * ephemeral (a restart, a flushed cache) while Postgres is the source of
 * truth, so this is what keeps the two from silently drifting apart. */
export async function initUnreadCounts(): Promise<void> {
  const { rows } = await pool.query<{ type: MessageType; count: string }>(
    `SELECT type, COUNT(*) FROM log_messages WHERE hidden = false GROUP BY type`,
  );
  const counts = new Map(rows.map((row) => [row.type, row.count]));
  await Promise.all(
    UNREAD_COUNT_TYPES.map((type) => redis.set(unreadCountKey(type), counts.get(type) ?? "0")),
  );
}

export async function getUnreadCounts(): Promise<Record<MessageType, number>> {
  const values = await Promise.all(UNREAD_COUNT_TYPES.map((type) => redis.get(unreadCountKey(type))));
  const counts = {} as Record<MessageType, number>;
  UNREAD_COUNT_TYPES.forEach((type, index) => {
    counts[type] = Number(values[index]) || 0;
  });
  return counts;
}

async function bumpUnreadCount(type: MessageType, delta: number): Promise<void> {
  await redis.incrby(unreadCountKey(type), delta);
}

export interface ProcessMessageListItem extends ProcessMessage {
  process_name: string;
  // Process Group (AGENTS.md section 10/17) the owning process belongs to -
  // added for the Logs page's processes tab (Group column), unused by the
  // notification center popup but harmless there.
  group_name: string;
  hidden_by_user: {
    id: number;
    display_name: string | null;
    username: string;
    avatar_path: string | null;
  } | null;
}

// "active" is deliberately not a scope here - the notification center's
// Active tab (AGENTS.md section 25) reads live process state (the fleet
// broadcast's own `messages` field, section 24) instead of this endpoint,
// since that's already exactly "currently active, unhidden" per process
// with no extra query needed. Only what still genuinely requires a
// Postgres round trip (the historical log) goes through here.
export type MessageScope = "new" | "all";

export interface ListProcessMessagesParams {
  type: MessageType | "all";
  scope: MessageScope;
  processId?: number;
  search?: string;
  // Inclusive ISO timestamp bounds - added for the Logs page's processes
  // tab (AGENTS.md section 29); the notification center popup never sets
  // these, so `scope`/`type`/`processId`/`search` alone still describe its
  // existing behavior unchanged.
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Server-side paginated feed, shared by the notification center popup
 * (AGENTS.md section 25) and the Logs page's processes tab (section 29) -
 * the first server-paginated list in this codebase (every other table,
 * section 11, is client-side, "tens of rows, not thousands"; this is an
 * append-only log that only grows).
 */
export async function listProcessMessages(
  params: ListProcessMessagesParams,
): Promise<{ items: ProcessMessageListItem[]; total: number }> {
  const { type, scope, processId, search, from, to, page, pageSize } = params;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (type !== "all") {
    values.push(type);
    conditions.push(`pm.type = $${values.length}`);
  }
  if (scope === "new") conditions.push("pm.hidden = false");
  if (processId !== undefined) {
    values.push(processId);
    conditions.push(`pm.process_id = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`pm.text ILIKE $${values.length}`);
  }
  if (from) {
    values.push(from);
    conditions.push(`pm.created_at >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`pm.created_at <= $${values.length}`);
  }
  const where = conditions.length > 0 ? conditions.join(" AND ") : "TRUE";

  const offset = (page - 1) * pageSize;
  const limitParam = values.length + 1;
  const offsetParam = values.length + 2;

  const [{ rows: items }, { rows: countRows }] = await Promise.all([
    pool.query<
      ProcessMessage & {
        process_name: string;
        group_name: string;
        hidden_by_display_name: string | null;
        hidden_by_username: string | null;
        hidden_by_avatar_path: string | null;
      }
    >(
      `SELECT pm.*, p.name AS process_name, g.name AS group_name,
              u.display_name AS hidden_by_display_name,
              u.username AS hidden_by_username,
              u.avatar_path AS hidden_by_avatar_path
       FROM log_messages pm
       JOIN processes p ON p.id = pm.process_id
       JOIN process_groups g ON g.id = p.group_id
       LEFT JOIN users u ON u.id = pm.hidden_by
       WHERE ${where}
       ORDER BY pm.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, pageSize, offset],
    ),
    pool.query<{ count: string }>(`SELECT COUNT(*) FROM log_messages pm WHERE ${where}`, values),
  ]);

  return {
    items: items.map(({ hidden_by_display_name, hidden_by_username, hidden_by_avatar_path, ...row }) => ({
      ...row,
      hidden_by_user:
        row.hidden_by !== null
          ? {
              id: row.hidden_by,
              display_name: hidden_by_display_name,
              username: hidden_by_username as string,
              avatar_path: hidden_by_avatar_path,
            }
          : null,
    })),
    total: Number(countRows[0].count),
  };
}
