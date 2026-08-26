import amqp, { type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel } from "amqplib";

import { config } from "./config.js";
import { logger } from "./logger.js";

// Shared topic exchange every publisher (this app today, others later) and
// consumer (apps/messaging-gateway) in the platform uses - see AGENTS.md
// section 9 for the routing-key scheme and envelope shape.
//
// Device and node domains (AGENTS.md sections 9/61) - process public state
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
  // AGENTS_TO_DO.md, 2026-08-23 - optional, not required: a metadata-only
  // event (rename/group/node reassignment/simulated/capabilities, see
  // `metadata` below) has no reading of its own to report. Was required
  // until today, forcing every publish site to supply *something* here -
  // switched to optional specifically so useLiveDevice.js's own reducer
  // can tell "no reading in this event" apart from "the reading is
  // genuinely absent/null" and merge accordingly, instead of a metadata
  // event clobbering the last known live value with `undefined`.
  value?: unknown;
  // Absent for a readOnly (sensor) device - it has no Dual Devices Model
  // concept at all (AGENTS.md section 6/7), unlike a controllable device,
  // which always has all three.
  mode?: string;
  valueAuto?: unknown;
  valueManual?: unknown;
  // AGENTS.md section 62 - present only when this event was published
  // because a fresh read's own computed overdue status actually differs
  // from what was last known (routes/devices.ts, dataLoggerControl.ts's
  // computeOverdue) - absent for an ordinary Dual Devices Model write
  // that isn't itself an overdue-status change.
  isOverdue?: boolean;
  expiresAt?: number | null;
  // AGENTS_TO_DO.md, 2026-08-23 - present only for a metadata change
  // (rename, Device Group membership, Node assignment, simulated toggle,
  // capabilities) - the same list-row shape `GET /devices` returns per
  // device (routes/devices.ts's `findDeviceListRow`), not a hand-picked
  // field subset, so a future new mutable metadata field starts flowing
  // through here for free (same reasoning as `NodeEventEnvelope.value`
  // below). Lets DevicesList.jsx patch its own row in place instead of
  // needing a full `GET /devices` poll for cross-tab convergence.
  metadata?: unknown;
  timestamp: string;
  source: string;
}

// AGENTS_TO_DO.md, 2026-08-16 - retires the `node.<id>.heartbeat` shape
// section 9 reserved (a node was never atomic-one-value like a Device, so
// there's no single "heartbeat" event type worth splitting out - one
// `updated` type carrying the whole live-ish row, same as device, covers
// both a discrete write (simulated/group/name) and an orchestrator-
// detected heartbeatStale tier change). `value` is deliberately the whole
// row (not a hand-picked field subset) so a future new mutable node field
// starts flowing through here for free.
export interface NodeEventEnvelope {
  domain: "node";
  entityId: number;
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
  return publish(`device.${envelope.entityId}.updated`, envelope);
}

export function publishNodeEvent(envelope: NodeEventEnvelope): Promise<void> {
  return publish(`node.${envelope.entityId}.updated`, envelope);
}
