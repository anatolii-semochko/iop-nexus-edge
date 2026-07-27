import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";

import type { BusEvent } from "./rabbitmq.js";
import { readProcessStateSnapshot, readStateSnapshot, subscriberRedis } from "./redis.js";
import { matchesAny } from "./topicMatch.js";

// Synthetic routing key for the process-state snapshot (AGENTS.md section
// 24) - it never actually travels as an AMQP routing key (this data never
// goes through RabbitMQ at all), but reusing the same `{routingKey, event}`
// shape as a live device event lets WS clients handle both with one code
// path, and lets a client's own `topics=` pattern filter it out the same
// way it would filter out `device.*`.
const PROCESS_STATE_ROUTING_KEY = "process.state.snapshot";

interface Subscriber {
  patterns: string[];
  send: (payload: unknown) => void;
}

export function buildServer() {
  const app = Fastify({ logger: true });
  const subscribers = new Set<Subscriber>();

  app.get("/health", async () => ({
    status: "ok",
    service: "messaging-gateway",
    subscribers: subscribers.size,
  }));

  app.register(websocketPlugin).register(async (instance) => {
    instance.get<{ Querystring: { topics?: string } }>("/ws", { websocket: true }, (socket, request) => {
      const requested = request.query.topics;
      // Default to "#" (everything) - a client that doesn't ask for a
      // narrower set gets the whole event stream, same as binding a queue
      // with no filter at all.
      const patterns = requested
        ? requested
            .split(",")
            .map((pattern) => pattern.trim())
            .filter(Boolean)
        : ["#"];

      const subscriber: Subscriber = {
        patterns,
        send: (payload) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(payload));
          }
        },
      };
      subscribers.add(subscriber);

      // Attached synchronously, before the async snapshot read below - a
      // client that disconnects while that read is in flight must still be
      // removed (see @fastify/websocket's own guidance on not doing async
      // work before wiring up handlers).
      socket.on("close", () => subscribers.delete(subscriber));

      Promise.all([readStateSnapshot(), readProcessStateSnapshot()])
        .then(([deviceSnapshot, processSnapshot]) => {
          const deviceEntries = deviceSnapshot.map((entry) => ({
            routingKey: `device.${entry.deviceId}.updated`,
            // Reshaped to the exact envelope shape live "event" messages
            // carry (AGENTS.md section 9) - entityId/timestamp, not this
            // cache row's own deviceId/updatedAt column names - so a
            // client can handle snapshot and live entries with one code
            // path instead of two slightly different shapes.
            event: {
              domain: "device",
              entityId: entry.deviceId,
              value: entry.value,
              mode: entry.mode,
              valueAuto: entry.valueAuto,
              valueManual: entry.valueManual,
              timestamp: entry.updatedAt,
              source: entry.source,
            },
          }));
          // At most one entry (AGENTS.md section 24) - unlike device
          // entries above (one per device), the whole fleet's process
          // state is one pre-assembled object, not something to fan out
          // per-process here.
          const processEntries = processSnapshot ? [toProcessStateEntry(processSnapshot)] : [];

          const matching = [...deviceEntries, ...processEntries].filter((entry) =>
            matchesAny(entry.routingKey, patterns),
          );
          subscriber.send({ type: "snapshot", events: matching });
        })
        .catch((err: unknown) => {
          app.log.warn({ err }, "failed to load initial state snapshot");
        });
    });
  });

  function broadcast(event: BusEvent): void {
    for (const subscriber of subscribers) {
      if (matchesAny(event.routingKey, subscriber.patterns)) {
        subscriber.send({ type: "event", routingKey: event.routingKey, event: event.envelope });
      }
    }
  }

  // apps/api's processBroadcast.ts notifies this channel (no payload beyond
  // a `source` string for logging) whenever it refreshes the fleet-wide
  // process-state cache key - timer tick, an urgent critical/warning/new-
  // message trigger, or a forced broadcast (AGENTS.md section 24). This is
  // the entire mechanism by which process state reaches WebSocket clients:
  // never through RabbitMQ, only this Redis Pub/Sub notify plus the cache
  // key it points at.
  subscriberRedis.subscribe("process:state:updated", (err) => {
    if (err) app.log.warn({ err }, "failed to subscribe to process state updates");
  });
  subscriberRedis.on("message", (channel, source) => {
    if (channel !== "process:state:updated") return;
    readProcessStateSnapshot()
      .then((snapshot) => {
        if (!snapshot) return;
        const entry = toProcessStateEntry(snapshot);
        broadcast({ routingKey: entry.routingKey, envelope: entry.event });
      })
      .catch((err: unknown) => {
        app.log.warn({ err, source }, "failed to broadcast process state update");
      });
  });

  return { app, broadcast };
}

function toProcessStateEntry(snapshot: {
  processes: unknown[];
  unreadCounts: Record<string, number>;
  timestamp: string;
  source: string;
}) {
  return {
    routingKey: PROCESS_STATE_ROUTING_KEY,
    event: {
      domain: "process",
      eventType: "snapshot",
      processes: snapshot.processes,
      unreadCounts: snapshot.unreadCounts,
      timestamp: snapshot.timestamp,
      source: snapshot.source,
    },
  };
}
