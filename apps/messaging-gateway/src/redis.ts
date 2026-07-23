import { Redis } from "ioredis";

import { config } from "./config.js";

export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
});

const STATE_KEY_PREFIX = "state:";

export interface CachedState {
  deviceId: string;
  resource: string;
  value: unknown;
  mode?: string;
  valueAuto?: unknown;
  valueManual?: unknown;
  updatedAt: string;
  source: string;
}

/**
 * Full snapshot of every device/resource state cached under `state:*` -
 * served to a WebSocket client right after it connects, so the UI has
 * current values before the first live event arrives. This service is a
 * read-only consumer of the cache: apps/api's Dual Devices Model
 * (dualDevicesModel.ts) is the only writer. Unlike the `dvm:*` keys it
 * writes for its own AUTO/MANUAL bookkeeping, `state:*` has no TTL - it is
 * last-known-value state (stays valid until the next write), not a
 * heartbeat/liveness signal.
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
    const [, deviceId, resource] = key.split(":");
    try {
      snapshot.push({ deviceId, resource, ...JSON.parse(raw) });
    } catch {
      // Same defensive stance as apps/api's dualDevicesModel.ts decode():
      // one malformed cache entry must not take the whole snapshot down.
    }
  });
  return snapshot;
}
