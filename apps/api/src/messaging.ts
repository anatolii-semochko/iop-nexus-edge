import amqp, { type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";

import { config } from "./config.js";
import { logger } from "./logger.js";

// Shared topic exchange every publisher (this app today, others later) and
// consumer (apps/messaging-gateway) in the platform uses - see AGENTS.md
// section 9 for the routing-key scheme and envelope shape.
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
 * Publishes a device/resource state change onto `nexus.events`. Best-effort
 * by design: a publish failure (RabbitMQ briefly unreachable, etc.) must
 * never break the device write path this is called from
 * (dualDevicesModel.ts) - amqp-connection-manager already buffers/retries
 * under the hood, this just guards against it rejecting outright.
 */
export async function publishDeviceEvent(envelope: DeviceEventEnvelope): Promise<void> {
  const routingKey = `device.${envelope.entityId}.${envelope.resource}.updated`;
  try {
    await channelWrapper.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(envelope)));
  } catch (err) {
    logger.warn({ err, routingKey }, "failed to publish device event to nexus.events");
  }
}
