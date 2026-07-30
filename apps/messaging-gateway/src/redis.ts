import { Redis } from "ioredis";

import { config } from "./config.js";

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

// A dedicated connection for Pub/Sub (AGENTS.md section 24) - once a
// connection issues SUBSCRIBE it can no longer run regular commands
// (GET/MGET/etc, ioredis's own constraint), so the process-state "wake up
// and re-read" signal from apps/api needs its own connection, separate
// from `redis` above which readStateSnapshot/readProcessStateSnapshot use
// for plain reads. `duplicate()` shares the same connection options.
export const subscriberRedis = redis.duplicate();

const STATE_KEY_PREFIX = "state:";
const PROCESS_STATE_KEY = "process:state:latest";

export interface CachedState {
  deviceId: string;
  value: unknown;
  mode?: string;
  valueAuto?: unknown;
  valueManual?: unknown;
  updatedAt: string;
  source: string;
}

/**
 * Full snapshot of every device's state cached under `state:*` - served to
 * a WebSocket client right after it connects, so the UI has current values
 * before the first live event arrives. This service is a read-only
 * consumer of the cache: apps/api's Dual Devices Model (dualDevicesModel.ts)
 * is the only writer. Unlike the `dvm:*` keys it writes for its own AUTO/
 * MANUAL bookkeeping, `state:*` has no TTL - it is last-known-value state
 * (stays valid until the next write), not a heartbeat/liveness signal.
 * One key per device (`state:{deviceId}`, AGENTS_TO_DO.md's 2026-07-27
 * Device/Node refactor) - a Device is atomic now, no resource dimension
 * left to key on.
 */
export async function readStateSnapshot(): Promise<CachedState[]> {
  const keys = await redis.keys(`${STATE_KEY_PREFIX}*`);
  if (keys.length === 0) {
    return [];
  }

  const values = await redis.mget(keys);
  const snapshot: CachedState[] = [];
  keys.forEach((key, index) => {
    const raw = values[index];
    if (!raw) return;
    const [, deviceId] = key.split(":");
    try {
      snapshot.push({ deviceId, ...JSON.parse(raw) });
    } catch {
      // Same defensive stance as apps/api's dualDevicesModel.ts decode():
      // one malformed cache entry must not take the whole snapshot down.
    }
  });
  return snapshot;
}

export interface ProcessFleetSnapshot {
  processes: unknown[];
  // Notification center (AGENTS.md section 25) - Redis-backed unread
  // counters, assembled by apps/api's processBroadcast.ts and relayed
  // as-is here, same as `processes`.
  unreadCounts: Record<string, number>;
  timestamp: string;
  source: string;
}

/**
 * The whole fleet's public process state, straight off the one cache key
 * apps/api's processBroadcast.ts writes on every timer tick and every
 * urgent trigger (AGENTS.md section 24). Unlike `state:*` above (many
 * keys, one per device resource), this is a single pre-assembled JSON
 * blob - this service never touches Postgres and never assembles the
 * fleet itself, it only relays what apps/api already put together. `null`
 * if apps/api hasn't broadcast yet (e.g. this service started before it
 * did) - callers treat that the same as "no processes yet", not an error.
 */
export async function readProcessStateSnapshot(): Promise<ProcessFleetSnapshot | null> {
  const raw = await redis.get(PROCESS_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProcessFleetSnapshot;
  } catch {
    return null;
  }
}
