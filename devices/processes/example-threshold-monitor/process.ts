/**
 * "example-threshold-monitor" - STARTER TEMPLATE, not a real process kind
 * (AGENTS_TO_DO.md, 2026-08-14 process management/Library catalog
 * discussion). Copy this whole folder into your target project's own
 * `plugins/<your-kind>/` (see nexus-edge's `scripts/add-process-kind.sh`),
 * rename the folder and the `register("example-threshold-monitor", ...)`
 * call below to your own kind name, then adapt the body - this is the
 * minimal shape a real process plugin needs, not a business capability
 * meant to be used as-is.
 *
 * What it demonstrates, following the same extension-point contract
 * every other target-project process plugin uses (see e.g.
 * nexus-edge-aquarium's plugins/control-node/process.ts for a real,
 * fuller example): reading a Device's live value, publishing a metric
 * for the process panel, and raising a WEM warning/error from a
 * two-sided min/max/warn range - the same pattern CORE's own
 * resourceMonitor.ts and control-node's own process.ts both already use,
 * just reduced to one generic device instead of several fixed ones.
 *
 * Zero imports from nexus-edge's own packages on purpose (see
 * apps/orchestrator/src/processPlugins.ts's own header comment for why -
 * a bind-mounted external file can't reliably resolve
 * "@nexus-edge/orchestrator" via normal Node module resolution) -
 * `apiClient`/`logger` arrive as plain function arguments instead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- registry/apiClient/logger types live in nexus-edge's own orchestrator package, not importable here (see file header).
export default function registerExampleThresholdMonitor(register: any, { apiClient, logger }: any): void {
  register("example-threshold-monitor", async (process: any) => {
    // Config shape (processes.config, set via POST /processes or PATCH
    // /processes/:id/config) - deviceId is the one thing actually
    // required; the four thresholds are all optional, same "omitted
    // means don't check that side" convention as every other threshold
    // config in this codebase (resourceMonitor.ts, control-node's own
    // process.ts).
    const { deviceId, min, max, warnMin, warnMax } = process.config;

    if (deviceId === undefined) {
      logger.warn({ processId: process.id }, "example-threshold-monitor is missing config.deviceId");
      return;
    }

    const device = await apiClient.getDevice(deviceId);
    const value = Number(device.value);
    if (!Number.isFinite(value)) {
      logger.warn({ processId: process.id, deviceId }, "example-threshold-monitor: no valid reading");
      return;
    }

    // Live reading for this process's own panel (same setMetrics/live-feed
    // mechanism every other process kind uses) - rename "value" to
    // something meaningful once you're not generic anymore.
    await apiClient.setMetrics(process.id, { value });

    const belowMin = (v: number, m: number | undefined) => m !== undefined && v < m;
    const aboveMax = (v: number, m: number | undefined) => m !== undefined && v > m;

    const isError = belowMin(value, min) || aboveMax(value, max);
    const isWarning = !isError && (belowMin(value, warnMin) || aboveMax(value, warnMax));

    await apiClient.setCritical(process.id, isError);
    await apiClient.setWarning(process.id, isWarning);
    await apiClient.syncMessages(process.id, "error", isError
      ? [{ code: "value_error", level: 1, text: `Value ${value} is outside [${min ?? "-inf"}, ${max ?? "+inf"}]` }]
      : []);
    await apiClient.syncMessages(process.id, "warning", isWarning
      ? [{ code: "value_warning", level: 1, text: `Value ${value} is outside [${warnMin ?? "-inf"}, ${warnMax ?? "+inf"}]` }]
      : []);
  });
}
