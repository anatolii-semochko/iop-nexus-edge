# Tests

No automated tests yet, consistent with every other device type in this
repo. Live-verified indirectly: control-node's real buzzer instance
(reassigned to this type 2026-08-14) was already confirmed sounding
correctly on real hardware via CAN before/after the crackle-bug fix
(AGENTS.md section 51) - this type change itself is a NexusEdge-side
taxonomy reassignment with no EdgeX/CAN contract change, so nothing new
needed re-verifying on the wire.
