# example-threshold-monitor (template)

Not a real process kind - a starter template for a target project's own
process plugin. See `../process.ts`'s own header for the full contract
explanation.

## Using it

1. Copy this folder into your target project, e.g. via nexus-edge's
   `scripts/add-process-kind.sh example-threshold-monitor <target-project-path> <your-kind-name>`.
2. Rename the `register("example-threshold-monitor", ...)` call in the
   copied `process.ts` to your own kind name (must match the `kind`
   column of whatever `processes` row you create for it).
3. Adapt the body - this template watches exactly one Device against a
   two-sided min/max/warn range; a real process kind usually needs more
   than one device (see nexus-edge-aquarium's `plugins/control-node/
   process.ts` for a fuller real example).
4. Create the actual `processes` row (`POST /processes`, or through the
   Processes page's own "Add process" UI) with `kind` matching step 2 and
   a `config` shaped like:
   ```json
   { "deviceId": 42, "min": 10, "max": 30, "warnMin": 15, "warnMax": 25 }
   ```
5. Restart the orchestrator so it loads the new plugin file
   (`loadProcessPlugins()` only scans `EXTRA_PROCESS_PLUGINS_DIR` once at
   startup - see nexus-edge's AGENTS.md section 51). The Processes page
   flags a row as "pending restart" until then.

## Config

| Field     | Required | Meaning                                    |
|-----------|----------|---------------------------------------------|
| `deviceId`| yes      | Which Device to read each tick             |
| `min`     | no       | Below this -> error                        |
| `max`     | no       | Above this -> error                        |
| `warnMin` | no       | Below this (and not already error) -> warning |
| `warnMax` | no       | Above this (and not already error) -> warning |
