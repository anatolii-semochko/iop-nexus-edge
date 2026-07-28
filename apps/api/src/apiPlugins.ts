import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { FastifyInstance } from "fastify";

import { config } from "./config.js";

/**
 * Command-API extension points (extension points design, to-do.txt
 * 2026-07-28). A DNP folder (devices/standalone/<type>/,
 * devices/nodes/<node-type>/devices/<type>/, or a target project's own
 * plugins/<name>/) MAY carry one api.ts, needed only when the generic
 * Device API (write/auto/simulate) and Process API aren't enough. None
 * exist today (zero consumers) - this module's only job right now is to
 * scan for them and register whatever it finds, so the day one is added
 * (Library or private, identical mechanism, no special-casing) it just
 * works without touching this file.
 *
 * Node (22.6+) strips TypeScript types natively, so a plugin authored as
 * plain typed TS (matching every other DNP file) can be dynamic-imported
 * directly - no separate build step for devices/**\/api.ts.
 *
 * A plugin file's default export must be a standard Fastify plugin
 * function: `export default async function(app: FastifyInstance) {...}`
 * - the same shape every routes/*.ts in this app already exports (see
 * e.g. routes/heartbeatControls.ts), just always the default export so
 * this loader doesn't need to know a plugin's function name.
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
      const mod = (await import(pathToFileURL(file).href)) as { default?: (app: FastifyInstance) => Promise<void> };
      if (typeof mod.default !== "function") {
        throw new Error(`${file}: api.ts must have a default export (async function(app) {...})`);
      }
      app.log.info({ source: source.label, file }, "registering DNP api.ts plugin");
      await app.register(mod.default);
    }
  }
}
