// Tiny in-process signal between processRegistry.ts/processMessages.ts
// (writers of a process's public state) and processBroadcast.ts (the fleet-
// wide broadcaster - AGENTS.md section 24), so an urgent change can trigger
// an out-of-band broadcast without those two writer modules importing
// processBroadcast.ts directly - processBroadcast.ts already imports them
// (to assemble the fleet snapshot), and the reverse import would be a
// circular dependency. A plain EventEmitter is the whole mechanism; nothing
// here is process-specific, a future writer just emits "urgent" too.

import { EventEmitter } from "node:events";

export const processStateEvents = new EventEmitter();
