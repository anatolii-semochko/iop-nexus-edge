import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import { syncLibrary } from "../libraryCatalog.js";

type Kind = "device" | "node";

interface CategoryRow {
  id: number;
  parent_id: number | null;
  kind: Kind;
  name: string;
  description: string | null;
  icon_path: string | null;
}

interface ItemRow {
  id: string;
  category_id: number | null;
  kind: Kind;
  name: string;
  description: string | null;
  icon_path: string | null;
  type_name: string;
  supports: string[] | null;
}

async function usedTypeNames(kind: Kind): Promise<Set<string>> {
  const table = kind === "device" ? "devices" : "nodes";
  const { rows } = await pool.query<{ type: string }>(`SELECT DISTINCT type FROM ${table}`);
  return new Set(rows.map((r) => r.type));
}

async function breadcrumbFor(categoryId: number | null): Promise<{ id: number; name: string }[]> {
  const trail: { id: number; name: string }[] = [];
  let currentId = categoryId;
  while (currentId !== null) {
    const { rows } = await pool.query<{ id: number; name: string; parent_id: number | null }>(
      `SELECT id, name, parent_id FROM library_categories WHERE id = $1`,
      [currentId],
    );
    if (!rows[0]) break;
    trail.unshift({ id: rows[0].id, name: rows[0].name });
    currentId = rows[0].parent_id;
  }
  return trail;
}

// UI surface for AGENTS.md's Library Catalog section - a read-only
// browser (categories/items are managed by moving folders in git, not
// through this app) over what libraryCatalog.ts's sync last found.
export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/library/sync", async () => {
    return syncLibrary();
  });

  // Breadcrumb + one folder level's worth of children (subcategories and
  // leaf items mixed, sorted by name) - `categoryId` omitted/null means
  // the root of `kind`'s own tree (device and node are two independent
  // trees, AGENTS.md section 32).
  app.get<{ Querystring: { kind: Kind; categoryId?: string } }>("/library/browse", async (request, reply) => {
    const { kind } = request.query;
    if (kind !== "device" && kind !== "node") {
      return reply.code(400).send({ error: "kind must be 'device' or 'node'" });
    }
    const categoryId = request.query.categoryId ? Number(request.query.categoryId) : null;

    const [breadcrumb, used, categories, items] = await Promise.all([
      breadcrumbFor(categoryId),
      usedTypeNames(kind),
      pool.query<CategoryRow>(
        `SELECT id, parent_id, kind, name, description, icon_path FROM library_categories
         WHERE kind = $1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY name`,
        [kind, categoryId],
      ),
      pool.query<ItemRow>(
        `SELECT id, category_id, kind, name, description, icon_path, type_name, supports FROM library_items
         WHERE kind = $1 AND category_id IS NOT DISTINCT FROM $2 ORDER BY name`,
        [kind, categoryId],
      ),
    ]);

    return {
      breadcrumb,
      children: [
        ...categories.rows.map((c) => ({
          type: "category" as const,
          id: c.id,
          name: c.name,
          description: c.description,
          iconPath: c.icon_path,
        })),
        ...items.rows.map((i) => ({
          type: "item" as const,
          id: i.id,
          name: i.name,
          description: i.description,
          iconPath: i.icon_path,
          typeName: i.type_name,
          supports: i.supports,
          usedInProject: used.has(i.type_name),
        })),
      ],
    };
  });

  // Flat, cross-category search by name/description (AGENTS_TO_DO.md: "для
  // пошуку" was an explicit goal) - not scoped to the currently browsed
  // folder.
  app.get<{ Querystring: { kind: Kind; q?: string } }>("/library/search", async (request, reply) => {
    const { kind, q } = request.query;
    if (kind !== "device" && kind !== "node") {
      return reply.code(400).send({ error: "kind must be 'device' or 'node'" });
    }
    if (!q) return [];

    const [used, items] = await Promise.all([
      usedTypeNames(kind),
      pool.query<ItemRow>(
        `SELECT id, category_id, kind, name, description, icon_path, type_name, supports FROM library_items
         WHERE kind = $1 AND (name ILIKE $2 OR description ILIKE $2) ORDER BY name`,
        [kind, `%${q}%`],
      ),
    ]);

    return items.rows.map((i) => ({
      id: i.id,
      categoryId: i.category_id,
      name: i.name,
      description: i.description,
      iconPath: i.icon_path,
      typeName: i.type_name,
      supports: i.supports,
      usedInProject: used.has(i.type_name),
    }));
  });
}
