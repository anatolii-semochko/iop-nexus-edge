import amqp, { type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";

import { config } from "./config.js";
import { logger } from "./logger.js";

// Shared topic exchange every publisher (this app today, others later) and
// consumer (apps/messaging-gateway) in the platform uses - see AGENTS.md
// section 9 for the routing-key scheme and envelope shape.
//
// Device domain only (AGENTS.md section 24) - process public state
// deliberately does NOT go through this exchange. Its only consumers are
// this same service (REST) and apps/messaging-gateway (WS fan-out), never
// an independent subscriber that would benefit from a durable topic
// exchange the way device commands/telemetry do (potentially many future
// consumers, persistence across a brief outage). It flows through Redis
// instead - processRegistry.ts's `process:{id}:public` hash plus
// processBroadcast.ts's cache key and pub/sub notify - keeping
// `nexus.events` for what it's actually for.
export const EVENTS_EXCHANGE = "nexus.events";

export interface DeviceEventEnvelope {
  domain: "device";
  entityId: number;
  resource: string;
  value: unknown;
  // Absent for a readOnly (sensor) resource - it has no Dual Devices Model
  // concept at all (AGENTS.md section 6/7), unlike a controllable resource,
  // which always has all three.
  mode?: string;
  valueAuto?: unknown;
  valueManual?: unknown;
  timestamp: string;
  source: string;
}

const connection = amqp.connect([config.rabbitmq.url]);
connection.on("connect", () => logger.info("connected to RabbitMQ"));
connection.on("disconnect", (params) => logger.warn({ err: params.err }, "disconnected from RabbitMQ"));

const channelWrapper: ChannelWrapper = connection.createChannel({
  setup: (channel: ConfirmChannel) => channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true }),
});

/**
 * Publishes onto `nexus.events`. Best-effort by design: a publish failure
 * (RabbitMQ briefly unreachable, etc.) must never break the write path
 * this is called from (dualDevicesModel.ts) - amqp-connection-manager
 * already buffers/retries under the hood, this just guards against it
 * rejecting outright.
 */
async function publish(routingKey: string, envelope: unknown): Promise<void> {
  try {
    await channelWrapper.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(envelope)));
  } catch (err) {
    logger.warn({ err, routingKey }, "failed to publish event to nexus.events");
  }
}

export function publishDeviceEvent(envelope: DeviceEventEnvelope): Promise<void> {
  return publish(`device.${envelope.entityId}.${envelope.resource}.updated`, envelope);
}
