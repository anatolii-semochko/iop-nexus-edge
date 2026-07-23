import amqp, { type ChannelWrapper } from "amqp-connection-manager";
import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import { config } from "./config.js";
import { logger } from "./logger.js";

// The one topic exchange every publisher (apps/api today, others later)
// and consumer (this gateway) in the platform shares - see AGENTS.md
// section 9 for the routing-key scheme and envelope shape.
export const EXCHANGE = "nexus.events";

export interface BusEvent {
  routingKey: string;
  envelope: Record<string, unknown>;
}

export type BusEventHandler = (event: BusEvent) => void;

/**
 * Binds a single exclusive, auto-delete queue to "#" (every routing key) -
 * per-WebSocket-client filtering happens in-process (topicMatch.ts)
 * instead of one RabbitMQ binding per client, so the exchange/queue
 * topology here stays fixed regardless of how many UI clients come and go.
 * amqp-connection-manager handles reconnects; `setup` re-runs automatically
 * after every reconnect, so the queue/binding/consumer are re-established
 * without any code here noticing the drop.
 */
export function connectConsumer(onEvent: BusEventHandler): ChannelWrapper {
  const connection = amqp.connect([config.rabbitmq.url]);
  connection.on("connect", () => logger.info("connected to RabbitMQ"));
  connection.on("disconnect", (params) => logger.warn({ err: params.err }, "disconnected from RabbitMQ"));

  const channelWrapper = connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      await channel.assertExchange(EXCHANGE, "topic", { durable: true });
      const { queue } = await channel.assertQueue("", { exclusive: true, autoDelete: true });
      await channel.bindQueue(queue, EXCHANGE, "#");
      await channel.consume(queue, (message: ConsumeMessage | null) => {
        if (!message) return;
        try {
          const envelope = JSON.parse(message.content.toString("utf8"));
          onEvent({ routingKey: message.fields.routingKey, envelope });
        } catch (err) {
          logger.warn({ err }, "dropped malformed message from nexus.events");
        }
        channel.ack(message);
      });
    },
  });

  return channelWrapper;
}
