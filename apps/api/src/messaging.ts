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

// First expansion of the bus beyond the "device" domain (AGENTS.md section
// 10) - a process's on/off status, critical flag, (section 21) warning
// flag, resource-monitor metrics, or (section 22) its active WEM message
// list. "metrics" is the odd one out here: the other four only publish on
// an actual change (see processRegistry's no-op-unless-different guard,
// and processMessages.syncActiveMessages' own changed-tracking) - metrics
// publishes unconditionally, once per orchestrator tick, so ".changed" in
// the routing key is a slight misnomer for it specifically, kept anyway
// for one shared scheme rather than a special case.
export interface ProcessEventEnvelope {
  domain: "process";
  entityId: number;
  field: "status" | "critical" | "warning" | "metrics" | "messages";
  value: unknown;
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
 * this is called from (dualDevicesModel.ts / processRegistry.ts) -
 * amqp-connection-manager already buffers/retries under the hood, this
 * just guards against it rejecting outright.
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

export function publishProcessEvent(envelope: ProcessEventEnvelope): Promise<void> {
  return publish(`process.${envelope.entityId}.${envelope.field}.changed`, envelope);
}
