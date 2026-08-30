import type { FastifyInstance } from "fastify";

import { pool } from "../db.js";
import { getLibraryItemDetail, syncLibrary } from "../libraryCatalog.js";

type Kind = "device" | "node" | "process";

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
  // processes has no "type" column - its own equivalent identity column
  // is "kind" (processRegistry's registration key, e.g. "resource-monitor",
  // "control-node") - matches library_items.type_name for kind "process".
  if (kind === "process") {
    const { rows } = await pool.query<{ kind: string }>(`SELECT DISTINCT kind FROM processes`);
    return new Set(rows.map((r) => r.kind));
  }
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
    if (kind !== "device" && kind !== "node" && kind !== "process") {
      return reply.code(400).send({ error: "kind must be 'device', 'node', or 'process'" });
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

  // Expanded-row detail (AGENTS_TO_DO.md, 2026-08-27) - README/CHANGELOG
  // prose, EdgeX profile specs, and cross-linked compatibility, read
  // fresh from disk on every call rather than synced into Postgres (see
  // getLibraryItemDetail's own doc comment for why). `id` is the DN's
  // own library.json id, same identity everything else in this route
  // file already keys on.
  app.get<{ Params: { id: string } }>("/library/items/:id/detail", async (request, reply) => {
    const { rows } = await pool.query<{ folder_path: string; kind: Kind; type_name: string }>(
      `SELECT folder_path, kind, type_name FROM library_items WHERE id = $1`,
      [request.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    return getLibraryItemDetail(rows[0].folder_path, rows[0].kind, rows[0].type_name);
  });

  // Type-column deep link (AGENTS_TO_DO.md, 2026-08-30) - resolves a
  // Node/Device/Process row's own type/kind column (type_name in Library
  // terms) straight to its Library item, for the "link" cell opened in a
  // new tab from DevicesList/NodesList/ProcessesTable. Same row shape as
  // /library/browse's own item rows (plus breadcrumb) so LibraryBrowser.jsx
  // can render it without a second round trip - unlike /location, which
  // only resolves an id to a place to browse, this resolves a (kind,
  // typeName) pair straight to the item itself since the caller never had
  // a library_items.id to begin with, only the type name shown in the row.
  app.get<{ Querystring: { kind: Kind; typeName?: string } }>("/library/items/by-type", async (request, reply) => {
    const { kind, typeName } = request.query;
    if (kind !== "device" && kind !== "node" && kind !== "process") {
      return reply.code(400).send({ error: "kind must be 'device', 'node', or 'process'" });
    }
    if (!typeName) return reply.code(400).send({ error: "typeName is required" });

    const [used, { rows }] = await Promise.all([
      usedTypeNames(kind),
      pool.query<ItemRow>(
        `SELECT id, category_id, kind, name, description, icon_path, type_name, supports FROM library_items
         WHERE kind = $1 AND type_name = $2 LIMIT 1`,
        [kind, typeName],
      ),
    ]);
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    const item = rows[0];

    return {
      breadcrumb: await breadcrumbFor(item.category_id),
      item: {
        type: "item" as const,
        id: item.id,
        name: item.name,
        description: item.description,
        iconPath: item.icon_path,
        typeName: item.type_name,
        supports: item.supports,
        usedInProject: used.has(item.type_name),
      },
    };
  });

  // Cross-item doc-link navigation (AGENTS_TO_DO.md, 2026-08-27 markdown-
  // viewer follow-up) - the Documentation tab's `library-item://<id>`
  // links (rewritten server-side by libraryCatalog.ts's own
  // rewriteDocLinks) resolve to a target item that may live in a
  // different kind/category than whatever's currently browsed; this is
  // just enough for LibraryBrowser.jsx to re-navigate there (`kind` +
  // `categoryId`) before expanding it, not a full item payload.
  app.get<{ Params: { id: string } }>("/library/items/:id/location", async (request, reply) => {
    const { rows } = await pool.query<{ kind: Kind; category_id: number | null }>(
      `SELECT kind, category_id FROM library_items WHERE id = $1`,
      [request.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "not found" });
    return { kind: rows[0].kind, categoryId: rows[0].category_id };
  });

  // Flat, cross-category search by name/description (AGENTS_TO_DO.md: "для
  // пошуку" was an explicit goal) - not scoped to the currently browsed
  // folder.
  app.get<{ Querystring: { kind: Kind; q?: string } }>("/library/search", async (request, reply) => {
    const { kind, q } = request.query;
    if (kind !== "device" && kind !== "node" && kind !== "process") {
      return reply.code(400).send({ error: "kind must be 'device', 'node', or 'process'" });
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
