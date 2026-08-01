import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { apiClient } from "./apiClient.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { processRegistry, type ProcessRunner } from "./processRegistry.js";

/**
 * Extension points (AGENTS_TO_DO.md 2026-07-29) - a target project's own
 * process kind, loaded from EXTRA_PROCESS_PLUGINS_DIR (env, a mounted
 * directory - unset here, nothing to scan for this repo's own
 * docker-compose). Same mechanism as apps/api's apiPlugins.ts: Node 22
 * strips TypeScript types natively, so a plugin authored as plain typed
 * TS can be dynamic-imported directly, no build step.
 *
 * Unlike apiPlugins.ts's Fastify plugins (which receive the shared `app`
 * instance as their only argument), a process plugin's default export
 * receives `register` and a small `{ apiClient, logger }` context as
 * plain function arguments - deliberately NOT importing anything from
 * "@nexus-edge/orchestrator" itself. This avoids relying on Node module
 * resolution finding that package from an arbitrary mounted file path
 * (which would need a workaround like a self-referencing node_modules
 * symlink) - passing dependencies in as parameters, the same way
 * apiPlugins.ts's `app` argument already does, sidesteps the problem
 * entirely. No separate npm package/Dockerfile needed on the target
 * project's side (a real npm `file:` dependency on
 * "@nexus-edge/orchestrator" - processRegistry's own export, section 31 -
 * remains possible for a target project that specifically wants tighter
 * integration, just isn't what this loader requires).
 */

interface ProcessPluginContext {
  apiClient: typeof apiClient;
  logger: typeof logger;
}

type ProcessPluginModule = (register: (kind: string, runner: ProcessRunner) => void, ctx: ProcessPluginContext) => void;

async function findProcessPluginFiles(dir: string): Promise<string[]> {
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
      files.push(...(await findProcessPluginFiles(entryPath)));
    } else if (entry.isFile() && entry.name === "process.ts") {
      files.push(entryPath);
    }
  }
  return files;
}

export async function loadProcessPlugins(): Promise<void> {
  const dir = config.processPlugins.extraDir;
  if (!dir) return;

  const files = await findProcessPluginFiles(dir);
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: ProcessPluginModule };
    if (typeof mod.default !== "function") {
      throw new Error(`${file}: process.ts must have a default export (function(register, ctx) {...})`);
    }
    logger.info({ file }, "registering process plugin");
    mod.default((kind, runner) => processRegistry.register(kind, runner), { apiClient, logger });
  }
}
