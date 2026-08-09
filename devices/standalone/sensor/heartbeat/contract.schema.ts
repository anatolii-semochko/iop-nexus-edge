/**
 * Heartbeat - atomic sensor, independent library Device type (AGENTS.md
 * section 7/30/32), added 2026-08-09 for the "НОДА КОНТРОЛЮ" watchdog
 * board (AGENTS_TO_DO.md). A free-running `Uint32` counter, incremented
 * once per second by the node's own firmware, wrapping silently at
 * 2^32 (~136 years at 1Hz - not a practical concern). Its *value* is
 * meaningless on its own - what matters is whether it has **changed**
 * since the last time something read it. That is deliberate: EdgeX's CAN
 * transport caches "latest frame per arbitration ID" with no expiry
 * (`apps/device-service/internal/transport/can/bus.go`), so a resource
 * whose value never changes (e.g. a plain `Bool` "alive" flag) would read
 * as perpetually true even if the physical node stopped transmitting
 * hours ago. A monotonically incrementing counter is the simplest value
 * that lets a poller (the control-node's own permanent process) tell
 * "fresh" from "stale cache" without relying on any wall-clock timestamp
 * travelling over the wire - the STM32 has no synced RTC to put one in.
 *
 * This is the software-side half of this node type's *two* independent
 * heartbeat directions (see `../pulse` for the other): this device lets
 * NexusEdge's own Heartbeating Control (AGENTS.md section 28) detect "is
 * this node's firmware/link alive", separate from and independent of
 * `pulse`, which lets the node's own firmware detect "is NexusEdge
 * alive" (confirmed with the user, AGENTS_TO_DO.md 2026-08-09: "Не
 * плутаємо! NexusEdge контролює серцебиття ноди. А нода контролює
 * серцебиття NexusEdge. Незалежно один від другого.").
 */
export const heartbeatContract = {
  deviceType: 'heartbeat',
  readOnly: true,
  valueType: 'Uint32',
  units: 'count',
  description: "Free-running counter, incremented once/sec by the node's own firmware",
}
