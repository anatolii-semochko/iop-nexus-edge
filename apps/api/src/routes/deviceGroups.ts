import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";

// Device Groups (AGENTS_TO_DO.md, 2026-08-01) - logical/business groups
// for Devices (entrance guard panel, central security panel, boiler room
// boiler, garage climate control...), many-to-many like Tab/Message
// Groups (AGENTS.md section 22-23): a Device is a logical workplace and
// can appear in several groups at once (shared devices - e.g. a siren in
// both a "fire" and "intrusion" group). Unordered - no position/reorder,
// unlike tab_groups.

interface DeviceGroupRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
}

async function withDeviceIds(group: DeviceGroupRow) {
  const result = await pool.query<{ device_id: number }>(
    "SELECT device_id FROM device_device_groups WHERE device_group_id = $1",
    [group.id],
  );
  return { ...group, deviceIds: result.rows.map((row) => row.device_id) };
}

export async function deviceGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/device-groups", async () => {
    const result = await pool.query<DeviceGroupRow>("SELECT * FROM device_groups ORDER BY name");
    return Promise.all(result.rows.map(withDeviceIds));
  });

  app.post<{ Body: { name: string } }>("/device-groups", async (request, reply) => {
    const name = request.body.name?.trim();
    if (!name) return reply.code(400).send({ error: "name is required" });

    try {
      const result = await pool.query<DeviceGroupRow>(
        "INSERT INTO device_groups (name) VALUES ($1) RETURNING *",
        [name],
      );
      return reply.code(201).send(await withDeviceIds(result.rows[0]));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: "a group with this name already exists" });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>(
    "/device-groups/:id",
    async (request, reply) => {
      const name = request.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name is required" });

      try {
        const result = await pool.query<DeviceGroupRow>(
          "UPDATE device_groups SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
          [name, request.params.id],
        );
        if (!result.rows[0]) return reply.code(404).send({ error: "group not found" });
        return withDeviceIds(result.rows[0]);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return reply.code(409).send({ error: "a group with this name already exists" });
        }
        throw err;
      }
    },
  );

  // Freely deletable any time - no "must be empty" rule; ON DELETE
  // CASCADE cleans up device_device_groups.
  app.delete<{ Params: { id: string } }>("/device-groups/:id", async (request, reply) => {
    const result = await pool.query("DELETE FROM device_groups WHERE id = $1", [request.params.id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: "group not found" });
    return reply.code(204).send();
  });
}
