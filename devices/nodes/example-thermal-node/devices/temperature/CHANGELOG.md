# Changelog

## 2026-07-28

- Split out of the bundled `example-virtual-sensor-01` smoke-test fixture
  (originally introduced 2026-07-23) as part of the Device/Node correction
  (AGENTS.md section 30) - now its own atomic device on
  `example-thermal-node`, alongside `../heater`, `../cooler`, `../switch`.
  No behavior change - same simulated `Float32` reading, same read-only
  semantics, same 21.5 default.
