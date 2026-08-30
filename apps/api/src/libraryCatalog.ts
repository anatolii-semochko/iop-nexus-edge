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
// this with its own `plugins/devices/` (kind "device"), `plugins/nodes/`
// (kind "node"), and `plugins/processes/` (kind "process", added
// 2026-08-30 once the Type-column deep link - AGENTS_TO_DO.md same date -
// needed every process kind, not just device/node types, to actually
// resolve to something) subtrees. `plugins/processes/<kind>/library.json`
// is deliberately a SEPARATE location from where that kind's own
// `process.ts` actually lives (`plugins/<kind>/process.ts`, scanned by
// the orchestrator's own processPlugins.ts) - this tree only ever holds
// library.json/docs/icon, the same "design-time catalog is independent of
// runtime registration" split the public `devices/processes/` tree above
// already has.
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

/** Best-effort UTF-8 file read - `null` for a missing file (every file
 * this module reads is optional per-DN content, not a sync requirement),
 * rethrows anything else (a real I/O error shouldn't look like "this DN
 * just doesn't have one"). */
async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readYamlIfExists<T>(file: string): Promise<T | null> {
  const raw = await readTextIfExists(file);
  if (raw === null) return null;
  return parseYaml(raw) as T;
}

interface SafetyFile {
  forbidden?: unknown[];
}

interface EdgexDeviceProfile {
  manufacturer?: string;
  model?: string;
  labels?: string[];
  deviceResources?: {
    name?: string;
    description?: string;
    properties?: { valueType?: string; readWrite?: string };
  }[];
}

interface NodeYaml {
  nodeType?: string;
  bus?: { type?: string };
}

export interface LibraryItemDetail {
  readme: string | null;
  changelog: string | null;
  forbidden: unknown[] | null;
  technical:
    | {
        kind: "device";
        manufacturer: string | null;
        model: string | null;
        labels: string[] | null;
        resources: { name: string; description: string | null; valueType: string | null; readWrite: string | null }[];
      }
    | { kind: "node"; busType: string | null; hasFirmware: boolean }
    | null;
  compatibility: { id: string; name: string; iconPath: string | null; typeName: string }[];
}

/** Resolves a `library_items.folder_path` back to the on-disk directory
 * it was walked from - mirrors syncLibrary()'s own two root trees
 * ("private/..." for a target project's own plugins/, everything else
 * under this repo's own devices/). */
function resolveAbsDir(folderPath: string): string {
  if (folderPath === "private" || folderPath.startsWith("private/")) {
    if (!config.apiPlugins.extraDir) {
      throw new Error(`folder_path "${folderPath}" is private but no EXTRA_API_PLUGINS_DIR is configured`);
    }
    return path.join(config.apiPlugins.extraDir, folderPath.slice("private/".length));
  }
  return path.join(config.apiPlugins.builtinDevicesDir, folderPath);
}

/** Inverse of resolveAbsDir() - an on-disk package directory back to its
 * `folder_path` key, or `null` if it isn't under either known root (e.g.
 * a doc link pointing outside the Library entirely). Used by
 * rewriteDocLinks() below to turn a cross-item relative markdown link
 * into a lookup key. */
function absDirToFolderPath(absDir: string): string | null {
  const relBuiltin = path.relative(config.apiPlugins.builtinDevicesDir, absDir);
  if (relBuiltin && !relBuiltin.startsWith("..") && !path.isAbsolute(relBuiltin)) {
    return relBuiltin.split(path.sep).join("/");
  }
  if (config.apiPlugins.extraDir) {
    const relPrivate = path.relative(config.apiPlugins.extraDir, absDir);
    if (relPrivate && !relPrivate.startsWith("..") && !path.isAbsolute(relPrivate)) {
      return path.posix.join("private", relPrivate.split(path.sep).join("/"));
    }
  }
  return null;
}

// `[label](../../other-item/docs/README.md)` style relative links between
// two Library items' own docs/README.md|CHANGELOG.md (AGENTS_TO_DO.md,
// 2026-08-27 "розгортки елементів бібліотеки" - the markdown-viewer
// follow-up). Deliberately narrow: only `../`-relative `.md` links, not
// every possible markdown link shape.
const RELATIVE_MD_LINK_RE = /\[([^\]]+)\]\((\.\.?\/[^)\s]+\.md)\)/g;

/** Rewrites cross-item relative doc links in `text` (resolved against
 * `baseDir` - the directory the file containing `text` actually lives
 * in, e.g. `<pkg>/docs` for a README, `<pkg>` for a CHANGELOG) into an
 * app-internal `library-item://<id>` href the UI's Documentation tab
 * intercepts instead of navigating to a raw `.md` file path that has no
 * route of its own. A link whose target isn't itself a known Library
 * item's own package directory (typo, moved file, non-cross-item
 * relative link) is left exactly as written - best-effort, not a sync
 * failure. */
async function rewriteDocLinks(text: string, baseDir: string): Promise<string> {
  const matches = [...text.matchAll(RELATIVE_MD_LINK_RE)];
  if (matches.length === 0) return text;

  let result = text;
  for (const [full, label, relPath] of matches) {
    const resolvedFile = path.resolve(baseDir, relPath);
    // A link into another item's `docs/README.md` resolves one level
    // too deep for that item's own package directory - step back out of
    // `docs/`. Anything else (e.g. a CHANGELOG.md at the package root)
    // is already the package directory once its own filename is dropped.
    const packageDir =
      path.basename(path.dirname(resolvedFile)) === "docs"
        ? path.dirname(path.dirname(resolvedFile))
        : path.dirname(resolvedFile);
    const folderPath = absDirToFolderPath(packageDir);
    if (!folderPath) continue;
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM library_items WHERE folder_path = $1`, [
      folderPath,
    ]);
    if (!rows[0]) continue;
    result = result.replace(full, `[${label}](library-item://${rows[0].id})`);
  }
  return result;
}

/** On-demand detail read for one Library item's expanded row (AGENTS_TO_DO.md,
 * 2026-08-27 "розгортки елементів бібліотеки") - deliberately NOT synced
 * into Postgres alongside the rest of the catalog: this content
 * (README/CHANGELOG prose, EdgeX profile specs) is read-only reference
 * material a user only looks at when they expand one specific row, not
 * something any query filters/sorts by - re-reading straight from disk
 * on request keeps it perfectly fresh without a second sync pass to keep
 * in step with the first. `kind`/`typeName` come from the already-synced
 * `library_items` row (routes/library.ts), so this function only needs
 * `folderPath` to find the directory and `kind`/`typeName` to know which
 * kind-specific files to look for and which direction to resolve
 * compatibility in. */
export async function getLibraryItemDetail(
  folderPath: string,
  kind: Kind,
  typeName: string,
): Promise<LibraryItemDetail> {
  const absDir = resolveAbsDir(folderPath);

  const [readmeRaw, changelogRaw, safety] = await Promise.all([
    readTextIfExists(path.join(absDir, "docs", "README.md")),
    readTextIfExists(path.join(absDir, "CHANGELOG.md")),
    readYamlIfExists<SafetyFile>(path.join(absDir, "safety.yaml")),
  ]);
  const [readme, changelog] = await Promise.all([
    readmeRaw ? rewriteDocLinks(readmeRaw, path.join(absDir, "docs")) : Promise.resolve(null),
    changelogRaw ? rewriteDocLinks(changelogRaw, absDir) : Promise.resolve(null),
  ]);
  const forbidden = safety?.forbidden && safety.forbidden.length > 0 ? safety.forbidden : null;

  let technical: LibraryItemDetail["technical"] = null;
  let compatibility: LibraryItemDetail["compatibility"] = [];

  if (kind === "device") {
    const profile = await readYamlIfExists<EdgexDeviceProfile>(path.join(absDir, "edgex-device-profile.yaml"));
    if (profile) {
      technical = {
        kind: "device",
        manufacturer: profile.manufacturer ?? null,
        model: profile.model ?? null,
        labels: profile.labels ?? null,
        resources: (profile.deviceResources ?? []).map((r) => ({
          name: r.name ?? "",
          description: r.description ?? null,
          valueType: r.properties?.valueType ?? null,
          readWrite: r.properties?.readWrite ?? null,
        })),
      };
    }
    // Reverse of a node's own `supports` list - every node type whose
    // `supports` jsonb array contains this device's own type_name
    // (the `?` operator - "does this top-level array contain this
    // element" - not `@>`, which needs a jsonb value on both sides).
    const { rows } = await pool.query<{ id: string; name: string; icon_path: string | null; type_name: string }>(
      `SELECT id, name, icon_path, type_name FROM library_items
       WHERE kind = 'node' AND supports ? $1 ORDER BY name`,
      [typeName],
    );
    compatibility = rows.map((r) => ({ id: r.id, name: r.name, iconPath: r.icon_path, typeName: r.type_name }));
  } else if (kind === "node") {
    const [nodeYaml, firmwareEntries] = await Promise.all([
      readYamlIfExists<NodeYaml>(path.join(absDir, "node.yaml")),
      readdir(path.join(absDir, "firmware")).catch(() => []),
    ]);
    technical = { kind: "node", busType: nodeYaml?.bus?.type ?? null, hasFirmware: firmwareEntries.length > 0 };
    const { rows } = await pool.query<{ id: string; name: string; icon_path: string | null; type_name: string }>(
      `SELECT li.id, li.name, li.icon_path, li.type_name
       FROM library_items node, LATERAL jsonb_array_elements_text(node.supports) AS supported_type
       JOIN library_items li ON li.kind = 'device' AND li.type_name = supported_type
       WHERE node.folder_path = $1
       ORDER BY li.name`,
      [folderPath],
    );
    compatibility = rows.map((r) => ({ id: r.id, name: r.name, iconPath: r.icon_path, typeName: r.type_name }));
  }

  return { readme, changelog, forbidden, technical, compatibility };
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
    await walk(path.join(config.apiPlugins.extraDir, "processes"), "private/processes", "process", null, state);
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
