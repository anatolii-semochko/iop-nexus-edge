# Changelog

## 2026-07-28

- Split out of the bundled `example-virtual-sensor-01` smoke-test fixture
  (originally introduced 2026-07-23) as part of the Device/Node correction
  (AGENTS.md section 30) - now its own atomic device on
  `example-thermal-node`, alongside `../temperature`, `../heater`,
  `../cooler`. Was already unused by any process before the split, and
  remains so - kept per explicit instruction to preserve all four original
  devices rather than drop the idle one. No behavior change.
