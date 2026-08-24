// Library Catalog (AGENTS.md section 32) - rebuilds `library_categories`/
// `library_items` from devices/'s design-time layout (section 7) plus
// whatever private target-project plugins/ directory is mounted for this
// running instance. Not a table this app lets a user edit directly -
// categories/items are managed by moving folders in git; this is a cache
// of what's currently there, safe to fully re-derive any time.
//
// Three independent trees under the public Library: `devices/standalone/`
// (kind "device"), `devices/nodes/` (kind "node") - confirmed with the
// user, 2026-08-01, a Device no longer lives inside a Node's own folder
// (section 7's 2026-08-01 correction), so these are never merged into one
// walk - and `devices/processes/` (kind "process", added 2026-08-14 for
// the process management/Dev Simulator planning discussion - AGENTS_TO_DO.md
// same date - process *kinds* are a design-time catalog exactly like
// device/node types, just sourced from a third folder; a process kind's
// library.json is the same {id, name, description} shape). Private
// plugins/ (a target project's own DNPs, AGENTS.md section 31) mirrors
// this with its own `plugins/devices/` (kind "device") and
// `plugins/nodes/` (kind "node") subtrees, added 2026-08-24 once a real
// consumer needed a fully private node type (not just a private device
// type) - no private "processes" tree yet, since a process *kind*'s own
// registration already happens at runtime via `plugins/<name>/process.ts`,
// not through this design-time catalog.
//
// A folder is either:
// - a leaf item (`library.json` present) - not recursed into further,
//   the rest of its contents (config/, docs/, tests/, etc.) are that
//   item's own implementation detail, not catalog structure.
// - a category (`category.json` present) - recursed into, becomes the
//   parent of whatever's inside.
// - neither (e.g. `devices/standalone/` itself, or a category-less
//   pass-through folder) - recursed into with the same parent as its own
//   parent, contributing no row of its own.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { pool } from "./db.js";

type Kind = "device" | "node" | "process";

interface LibraryDescriptor {
  id: string;
  name: string;
  description?: string;
}

interface CategoryDescriptor {
  name: string;
  description?: string;
}

const ICON_NAMES = ["icon.svg", "icon.png"];

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Returns a URL path servable by the `/library-assets/<source>/*` static
 * mounts registered in server.ts, not a filesystem path - `sourceLabel`
 * ("library" | "private") picks which mount, `relDir` is this folder's
 * path relative to that source's own root. */
async function findIcon(absDir: string, entryNames: Set<string>, sourceLabel: string, relDir: string): Promise<string | null> {
  for (const name of ICON_NAMES) {
    if (entryNames.has(name)) return path.posix.join("/library-assets", sourceLabel, relDir, name);
  }
  return null;
}

/** node.yaml's own `supports:` list (AGENTS.md section 7/32) - purely
 * informational, best-effort: a missing/malformed node.yaml just means no
 * supports list, not a sync failure. */
async function readSupports(dir: string): Promise<string[] | null> {
  try {
    const raw = await readFile(path.join(dir, "node.yaml"), "utf-8");
    const parsed = parseYaml(raw) as { supports?: unknown };
    if (Array.isArray(parsed?.supports)) return parsed.supports.filter((v): v is string => typeof v === "string");
    return null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    logger.warn({ err, dir }, "failed to read node.yaml for Library Catalog supports list");
    return null;
  }
}

interface WalkState {
  seenCategoryPaths: Set<string>;
  seenItemFolderPaths: Set<string>;
}

async function upsertCategory(
  folderPath: string,
  kind: Kind,
  parentId: number | null,
  descriptor: CategoryDescriptor,
  iconPath: string | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO library_categories (folder_path, kind, parent_id, name, description, icon_path, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (folder_path) DO UPDATE
       SET kind = $2, parent_id = $3, name = $4, description = $5, icon_path = $6, updated_at = now()
     RETURNING id`,
    [folderPath, kind, parentId, descriptor.name, descriptor.description ?? null, iconPath],
  );
  return rows[0].id;
}

async function upsertItem(
  folderPath: string,
  kind: Kind,
  categoryId: number | null,
  descriptor: LibraryDescriptor,
  iconPath: string | null,
  typeName: string,
  supports: string[] | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO library_items
       (id, folder_path, kind, category_id, name, description, icon_path, type_name, supports, last_synced_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
     ON CONFLICT (id) DO UPDATE
       SET folder_path = $2, kind = $3, category_id = $4, name = $5, description = $6,
           icon_path = $7, type_name = $8, supports = $9, last_synced_at = now(), updated_at = now()`,
    [
      descriptor.id,
      folderPath,
      kind,
      categoryId,
      descriptor.name,
      descriptor.description ?? null,
      iconPath,
      typeName,
      supports ? JSON.stringify(supports) : null,
    ],
  );
}

async function walk(
  absDir: string,
  relPath: string,
  kind: Kind,
  parentCategoryId: number | null,
  state: WalkState,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  const entryNames = new Set(entries.map((e) => e.name));
  // `relPath` doubles as the folder_path key (devices-root-relative,
  // "private" prefixed for target-project plugins/ to keep the two trees
  // from colliding) and, stripped of that artificial "private" prefix,
  // the path relative to whichever static mount (`/library-assets/
  // library/*` or `/library-assets/private/*`, server.ts) actually
  // serves this folder's icon.
  const sourceLabel = relPath === "private" || relPath.startsWith("private/") ? "private" : "library";
  const sourceRelDir = sourceLabel === "private" ? relPath.slice("private".length).replace(/^\//, "") : relPath;

  const libraryDescriptor = entryNames.has("library.json")
    ? await readJsonIfExists<LibraryDescriptor>(path.join(absDir, "library.json"))
    : null;
  if (libraryDescriptor) {
    const iconPath = await findIcon(absDir, entryNames, sourceLabel, sourceRelDir);
    const typeName = path.basename(absDir);
    const supports = kind === "node" ? await readSupports(absDir) : null;
    await upsertItem(relPath, kind, parentCategoryId, libraryDescriptor, iconPath, typeName, supports);
    state.seenItemFolderPaths.add(relPath);
    return; // leaf - config/docs/tests/etc. below this are not catalog structure
  }

  const categoryDescriptor = entryNames.has("category.json")
    ? await readJsonIfExists<CategoryDescriptor>(path.join(absDir, "category.json"))
    : null;
  const categoryId = categoryDescriptor
    ? await upsertCategory(
        relPath,
        kind,
        parentCategoryId,
        categoryDescriptor,
        await findIcon(absDir, entryNames, sourceLabel, sourceRelDir),
      )
    : parentCategoryId;
  if (categoryDescriptor) state.seenCategoryPaths.add(relPath);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      await walk(path.join(absDir, entry.name), path.join(relPath, entry.name), kind, categoryId, state);
    }
  }
}

/** Recreates the whole catalog from disk - called once on `apps/api`
 * startup and on demand via `POST /library/sync` (routes/library.ts). */
export async function syncLibrary(): Promise<{ categories: number; items: number }> {
  const state: WalkState = { seenCategoryPaths: new Set(), seenItemFolderPaths: new Set() };

  await walk(path.join(config.apiPlugins.builtinDevicesDir, "standalone"), "standalone", "device", null, state);
  await walk(path.join(config.apiPlugins.builtinDevicesDir, "nodes"), "nodes", "node", null, state);
  await walk(path.join(config.apiPlugins.builtinDevicesDir, "processes"), "processes", "process", null, state);
  if (config.apiPlugins.extraDir) {
    await walk(path.join(config.apiPlugins.extraDir, "devices"), "private/devices", "device", null, state);
    await walk(path.join(config.apiPlugins.extraDir, "nodes"), "private/nodes", "node", null, state);
  }

  // Delete rows for folders that no longer exist (moved/renamed/removed
  // since the last sync) - `folder_path` is how a row is matched back to
  // its filesystem origin.
  const { rowCount: deletedItems } = await pool.query(
    `DELETE FROM library_items WHERE NOT (folder_path = ANY($1::text[]))`,
    [[...state.seenItemFolderPaths]],
  );
  const { rowCount: deletedCategories } = await pool.query(
    `DELETE FROM library_categories WHERE NOT (folder_path = ANY($1::text[]))`,
    [[...state.seenCategoryPaths]],
  );

  const { rows: itemCount } = await pool.query<{ count: string }>(`SELECT count(*) FROM library_items`);
  const { rows: categoryCount } = await pool.query<{ count: string }>(`SELECT count(*) FROM library_categories`);
  logger.info(
    { items: Number(itemCount[0].count), categories: Number(categoryCount[0].count), deletedItems, deletedCategories },
    "Library Catalog sync complete",
  );
  return { categories: Number(categoryCount[0].count), items: Number(itemCount[0].count) };
}
