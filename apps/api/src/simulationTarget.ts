import { pool } from "./db.js";

/**
 * Whether a Simulation process's own physical target (its Node, or a
 * standalone Device) is CURRENTLY in simulated mode right now - the
 * second of two independent gates a simulation process requires before it
 * should actually generate data (AGENTS_TO_DO.md, 2026-08-29): the
 * Simulator page's own ON/OFF switch (processes.status, Redis) AND the
 * target Node/Device's own `simulated` toggle, not either alone. Found
 * live: without this second check, a process left "on" (e.g. via the
 * Simulator switch, independent of the node) kept generating data even
 * while its own node's simulated toggle was off.
 *
 * Node-attached (`node_id` set) reads the node's own `simulated` column
 * directly; standalone (`device_id` set) reads through to the same
 * effective-simulated rule DevicesList.jsx's own
 * deviceEffectivelySimulated already uses client-side (its own `simulated`
 * if node-less, else its node's) - kept server-side here since this also
 * gates the orchestrator's own runner, not just a UI label.
 */
export async function isSimulationTargetSimulated(process: {
  node_id: number | null;
  device_id: number | null;
}): Promise<boolean> {
  if (process.node_id !== null) {
    const result = await pool.query<{ simulated: boolean }>("SELECT simulated FROM nodes WHERE id = $1", [
      process.node_id,
    ]);
    return result.rows[0]?.simulated ?? false;
  }
  if (process.device_id !== null) {
    const result = await pool.query<{ simulated: boolean; node_simulated: boolean | null }>(
      `SELECT d.simulated, n.simulated AS node_simulated
       FROM devices d LEFT JOIN nodes n ON n.id = d.node_id
       WHERE d.id = $1`,
      [process.device_id],
    );
    const row = result.rows[0];
    if (!row) return false;
    return row.node_simulated ?? row.simulated;
  }
  return false;
}
