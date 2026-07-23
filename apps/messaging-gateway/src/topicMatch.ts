// AMQP topic-exchange wildcard matching, reimplemented here in-process: the
// gateway keeps one static queue bound to the exchange with "#" (every
// routing key - see rabbitmq.ts) and filters per WebSocket client in this
// module, rather than creating a RabbitMQ binding per connected client.
// That keeps the exchange/queue topology fixed no matter how many UI
// clients connect or disconnect. Semantics match RabbitMQ's own topic
// exchange: "*" matches exactly one dot-separated word, "#" matches zero or
// more.

export function topicMatches(routingKey: string, pattern: string): boolean {
  return match(routingKey.split("."), pattern.split("."));
}

export function matchesAny(routingKey: string, patterns: string[]): boolean {
  return patterns.some((pattern) => topicMatches(routingKey, pattern));
}

function match(routingKeyParts: string[], patternParts: string[]): boolean {
  if (patternParts.length === 0) {
    return routingKeyParts.length === 0;
  }

  const [head, ...restPattern] = patternParts;

  if (head === "#") {
    // "#" matches zero words (try the rest of the pattern here) or one-plus
    // (consume one routing-key word and keep "#" in play).
    if (match(routingKeyParts, restPattern)) return true;
    return routingKeyParts.length > 0 && match(routingKeyParts.slice(1), patternParts);
  }

  if (routingKeyParts.length === 0) {
    return false;
  }

  const [rkHead, ...restRoutingKey] = routingKeyParts;
  if (head === "*" || head === rkHead) {
    return match(restRoutingKey, restPattern);
  }

  return false;
}
