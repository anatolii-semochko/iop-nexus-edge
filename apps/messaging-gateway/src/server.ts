import websocketPlugin from "@fastify/websocket";
import Fastify from "fastify";

import type { BusEvent } from "./rabbitmq.js";
import { readStateSnapshot } from "./redis.js";
import { matchesAny } from "./topicMatch.js";

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

      readStateSnapshot()
        .then((snapshot) => {
          const matching = snapshot
            .map((entry) => ({
              routingKey: `device.${entry.deviceId}.${entry.resource}.updated`,
              // Reshaped to the exact envelope shape live "event" messages
              // carry (AGENTS.md section 9) - entityId/timestamp, not this
              // cache row's own deviceId/updatedAt column names - so a
              // client can handle snapshot and live entries with one code
              // path instead of two slightly different shapes.
              event: {
                domain: "device",
                entityId: entry.deviceId,
                resource: entry.resource,
                value: entry.value,
                mode: entry.mode,
                valueAuto: entry.valueAuto,
                valueManual: entry.valueManual,
                timestamp: entry.updatedAt,
                source: entry.source,
              },
            }))
            .filter((entry) => matchesAny(entry.routingKey, patterns));
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

  return { app, broadcast };
}
