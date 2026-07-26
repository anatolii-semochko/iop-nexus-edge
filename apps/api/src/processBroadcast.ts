// Fleet-wide process public-state broadcast (AGENTS.md section 24). Reads
// every process's `process:{id}:public` hash (processRegistry.ts) plus its
// Postgres type (for the controllable-only status suppression withLiveState
// already applies), assembles one snapshot for the whole fleet, and makes
// it available two ways:
// - cached at a well-known Redis key (`process:state:latest`) that both
//   this service's own REST layer and apps/messaging-gateway can read
//   directly, no round trip back through here;
// - a lightweight Redis Pub/Sub notify (`process:state:updated`) so
//   apps/messaging-gateway - the only other reader - knows to re-read that
//   key and push to its WebSocket clients right away, instead of only
//   picking it up on its own polling schedule.
//
// Deliberately NOT published onto `nexus.events`/RabbitMQ (messaging.ts) -
// this data's only two consumers are this same process and
// apps/messaging-gateway, not an independent subscriber that would need a
// durable topic exchange the way device commands/telemetry do.

import { config } from "./config.js";
import { pool } from "./db.js";
import { logger } from "./logger.js";
import * as processMessages from "./processMessages.js";
import * as processRegistry from "./processRegistry.js";
import type { ProcessPublicState } from "./processRegistry.js";
import { processStateEvents } from "./processStateEvents.js";
import { redis } from "./redis.js";

export const SNAPSHOT_CACHE_KEY = "process:state:latest";
export const SNAPSHOT_UPDATED_CHANNEL = "process:state:updated";

// `Omit`s `status` from `ProcessPublicState` to widen it from always-present
// to optional - a permanent/system process reports no status at all here
// (see the assembly loop below), not the `"on"` default `getPublicState`
// would otherwise resolve to.
export interface ProcessFleetEntry extends Omit<ProcessPublicState, "status"> {
  id: number;
  status?: ProcessPublicState["status"];
  // Dashboard tab eligibility (AGENTS.md section 22/24) - Postgres, not
  // Redis (processRegistry.ts owns the hash this otherwise assembles from,
  // but this flag is set directly by processMessages.maybeFlagForDashboard,
  // outside that hash). Included here specifically because the UI's
  // Dashboard tab previously only ever saw this field once, from the REST
  // load at mount - a process getting (re-)flagged while the page stayed
  // open never appeared without a manual reload. Live now, same as
  // everything else in this snapshot.
  dashboardFlaggedAt: string | null;
  // Gates the Dashboard tab's remove-X (disabled until this is false,
  // enforced server-side too - DELETE .../dashboard-flag 400s otherwise).
  // Same staleness bug `dashboardFlaggedAt` above already had: read once
  // from REST at mount, a process whose active WEM genuinely resolved
  // while the page stayed open kept a stale `true` forever, silently
  // disabling the button at the DOM level (no click ever reached the
  // handler - reported live as "the button doesn't react to clicks at
  // all"). Live now for the same reason.
  hasActiveWem: boolean;
}

export interface ProcessFleetSnapshot {
  processes: ProcessFleetEntry[];
  // Notification center (AGENTS.md section 25) - unread counts per WEM
  // type, Redis-backed (processMessages.ts's own counters, not recomputed
  // here) and riding this same broadcast rather than a separate channel,
  // per the user's own direction: one systematic feed, not a second
  // parallel one just for this.
  unreadCounts: Record<processMessages.MessageType, number>;
  timestamp: string;
  // Why this particular broadcast fired - "timer" for the periodic
  // cadence, or what triggered an urgent one ("critical", "warning",
  // "messages", "read", "forced").
  source: string;
}

// Coalesces bursts of urgent triggers (e.g. several processes' critical
// flags flipping in the same tick, each on its own HTTP call from the
// orchestrator - AGENTS.md section 10) into a single broadcast instead of
// one per trigger. 250ms comfortably covers one process's full sequence of
// sequential-but-independent HTTP calls within a single orchestrator tick
// (setCritical, setWarning, setMetrics, syncMessages...), so by the time
// the coalesced broadcast actually fires, that tick's writes have settled.
const URGENT_DEBOUNCE_MS = 250;
let urgentTimer: ReturnType<typeof setTimeout> | undefined;

async function assembleSnapshot(source: string): Promise<ProcessFleetSnapshot> {
  const { rows } = await pool.query<{
    id: number;
    type: "controllable" | "permanent";
    dashboard_flagged_at: string | null;
  }>("SELECT id, type, dashboard_flagged_at FROM processes");

  const processes: ProcessFleetEntry[] = [];
  for (const { id, type, dashboard_flagged_at } of rows) {
    try {
      const [state, hasActiveWem] = await Promise.all([
        processRegistry.getPublicState(id),
        processMessages.hasActiveEntries(id),
      ]);
      processes.push({
        id,
        // Same suppression GET /processes' withLiveState applies - a
        // permanent/system process has no on/off concept, so it reports no
        // status at all here rather than a fabricated "on".
        status: type === "controllable" ? state.status : undefined,
        critical: state.critical,
        warning: state.warning,
        metrics: state.metrics,
        messages: state.messages,
        updatedAt: state.updatedAt,
        dashboardFlaggedAt: dashboard_flagged_at,
        hasActiveWem,
      });
    } catch (err) {
      // One process's malformed/unreachable cache entry must not take the
      // whole fleet snapshot down - same defensive stance as
      // apps/messaging-gateway's own snapshot parsing.
      logger.warn({ err, processId: id }, "failed to read process public state, omitting from broadcast");
    }
  }

  const unreadCounts = await processMessages.getUnreadCounts();

  return { processes, unreadCounts, timestamp: new Date().toISOString(), source };
}

async function broadcastNow(source: string): Promise<void> {
  const snapshot = await assembleSnapshot(source);
  try {
    await redis.set(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
    await redis.publish(SNAPSHOT_UPDATED_CHANNEL, source);
  } catch (err) {
    logger.warn({ err }, "failed to publish process state snapshot");
  }
}

/** Fires immediately, bypassing the debounce below - for the explicit
 * forced-broadcast endpoint (POST /processes/state/broadcast), where the
 * caller asked for this specific broadcast, not a coalesced one. */
export async function broadcastForced(source: string): Promise<void> {
  await broadcastNow(source);
}

function scheduleUrgentBroadcast(source: string): void {
  if (urgentTimer) return; // already coalescing a pending broadcast
  urgentTimer = setTimeout(() => {
    urgentTimer = undefined;
    void broadcastNow(source).catch((err) => logger.warn({ err }, "urgent process-state broadcast failed"));
  }, URGENT_DEBOUNCE_MS);
}

/** Wires up the periodic timer and the urgent-trigger listener - call once
 * at boot. */
export function startProcessStateBroadcastLoop(): void {
  processStateEvents.on("urgent", (event: { reason: string }) => scheduleUrgentBroadcast(event.reason));

  // One immediate broadcast at startup so a client connecting right after
  // boot doesn't wait a full interval for the first snapshot to exist.
  void broadcastNow("startup").catch((err) => logger.warn({ err }, "initial process-state broadcast failed"));

  setInterval(() => {
    void broadcastNow("timer").catch((err) => logger.warn({ err }, "periodic process-state broadcast failed"));
  }, config.processState.broadcastIntervalMs);
}
