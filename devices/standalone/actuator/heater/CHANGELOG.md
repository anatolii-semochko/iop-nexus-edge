# Changelog

## 2026-07-28

- Split out of the bundled `example-virtual-sensor-01` smoke-test fixture
  (originally introduced 2026-07-23) as part of the Device/Node correction
  (AGENTS.md section 30) - now its own atomic device on
  `example-thermal-node`, alongside `../temperature`, `../cooler`,
  `../switch`. Its forbidden-state rule against Cooler moved from a
  per-device (cross-resource) rule to the Node's own `safety.yaml`
  (cross-device) - same rule, correctly scoped. No other behavior change.
