import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { config } from "./config.js";
import { pool } from "./db.js";

/**
 * Command-API extension points (extension points design, AGENTS_TO_DO.md
 * 2026-07-28). A DNP folder (devices/standalone/<type>/,
 * devices/nodes/<node-type>/devices/<type>/, or a target project's own
 * plugins/<name>/) MAY carry one api.ts, needed only when the generic
 * Device API (write/auto/simulate) and Process API aren't enough.
 *
 * Node (22.6+) strips TypeScript types natively, so a plugin authored as
 * plain typed TS (matching every other DNP file) can be dynamic-imported
 * directly - no separate build step for devices/**\/api.ts.
 *
 * A plugin file's default export must be a standard Fastify plugin
 * function: `export default async function(app: FastifyInstance, {
 * pool }: { pool: Pool }) {...}` - the same shape every routes/*.ts in
 * this app already exports (see e.g. routes/heartbeatControls.ts), plus
 * `pool` (this app's own shared `pg` Pool, `db.ts`) passed as the
 * plugin's own Fastify `opts` - a plugin file living outside this
 * package (`devices/**\/api.ts`, or a target project's own private
 * `plugins/*\/api.ts`) has no `pg` of its own to import: a relative
 * import can't reach `db.ts`, and a bare `import { Pool } from "pg"`
 * fails at runtime (`ERR_MODULE_NOT_FOUND` - `pg` is only hoisted under
 * this package's own `node_modules`, confirmed live, section 71's own
 * `@coreui/*` UI-side counterpart of this exact problem). Passing the
 * already-open shared pool as a plugin argument sidesteps needing `pg`
 * resolvable from the plugin's own file location at all - the same
 * "receive dependencies as arguments, don't import them" reasoning
 * `processPlugins.ts`'s own `apiClient`/`logger` injection already uses.
 */

interface ApiPluginSource {
  label: string;
  dir: string;
}

async function findApiPluginFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findApiPluginFiles(entryPath)));
    } else if (entry.isFile() && entry.name === "api.ts") {
      files.push(entryPath);
    }
  }
  return files;
}

export async function loadApiPlugins(app: FastifyInstance): Promise<void> {
  const sources: ApiPluginSource[] = [
    { label: "library", dir: config.apiPlugins.builtinDevicesDir },
  ];
  if (config.apiPlugins.extraDir) {
    sources.push({ label: "private", dir: config.apiPlugins.extraDir });
  }

  for (const source of sources) {
    const files = await findApiPluginFiles(source.dir);
    for (const file of files) {
      const mod = (await import(pathToFileURL(file).href)) as {
        default?: (app: FastifyInstance, opts: { pool: typeof pool }) => Promise<void>;
      };
      if (typeof mod.default !== "function") {
        throw new Error(`${file}: api.ts must have a default export (async function(app, { pool }) {...})`);
      }
      app.log.info({ source: source.label, file }, "registering DNP api.ts plugin");
      await app.register(mod.default, { pool });
    }
  }
}
