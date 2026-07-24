import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MultipartFile } from "@fastify/multipart";
import type { FastifyInstance } from "fastify";

import { hashPassword, requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { pool } from "../db.js";

// Admin-managed user accounts (AGENTS.md section 13) - every route here
// requires the `admin` role, not just a logged-in session. `admin` and
// `system` are protected: `admin` can never be deleted or deactivated,
// `system` can never be deleted (but may be deactivated). This is the one
// place that distinction is encoded - the UI mirrors it only for display
// (disabling buttons), never re-implements the rule itself.
const PROTECTED_USERNAMES = new Set(["admin", "system"]);
const NON_DEACTIVATABLE_USERNAMES = new Set(["admin"]);

// The only role that means anything today (gates access to these very
// routes). `roles` is still a Postgres array, not a single string column,
// so adding a second meaningful role later is a code change, not a
// migration.
const ALLOWED_ROLES = new Set(["admin"]);

// Doubles as the allow-list (its keys) and the file extension to save each
// mimetype under.
const AVATAR_EXTENSIONS_BY_MIME_TYPE = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  roles: string[];
  avatar_path: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function publicUser(user: UserRow) {
  const { password_hash: _passwordHash, ...rest } = user;
  return {
    ...rest,
    deletable: !PROTECTED_USERNAMES.has(user.username),
    deactivatable: !NON_DEACTIVATABLE_USERNAMES.has(user.username),
  };
}

function validateRoles(roles: unknown): string[] | null {
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === "string" && ALLOWED_ROLES.has(r))) {
    return null;
  }
  return roles;
}

async function findUser(id: string): Promise<UserRow | undefined> {
  const result = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0];
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAdmin);

  app.get("/users", async () => {
    const result = await pool.query<UserRow>("SELECT * FROM users ORDER BY username");
    return result.rows.map(publicUser);
  });

  app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const user = await findUser(request.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    return publicUser(user);
  });

  app.post<{
    Body: { username: string; password: string; display_name?: string; roles?: string[]; active?: boolean };
  }>("/users", async (request, reply) => {
    const username = request.body.username?.trim().toLowerCase();
    const { password } = request.body;
    if (!username || !password) {
      return reply.code(400).send({ error: "username and password are required" });
    }
    const roles = validateRoles(request.body.roles ?? []);
    if (!roles) {
      return reply.code(400).send({ error: "roles must only contain known role names", allowed: [...ALLOWED_ROLES] });
    }

    const passwordHash = await hashPassword(password);
    try {
      const result = await pool.query<UserRow>(
        `INSERT INTO users (username, password_hash, display_name, roles, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [username, passwordHash, request.body.display_name ?? null, roles, request.body.active ?? true],
      );
      return reply.code(201).send(publicUser(result.rows[0]));
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        return reply.code(409).send({ error: "username already exists" });
      }
      throw err;
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { password?: string; display_name?: string; roles?: string[]; active?: boolean };
  }>("/users/:id", async (request, reply) => {
    const user = await findUser(request.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });

    if (request.body.active === false && NON_DEACTIVATABLE_USERNAMES.has(user.username)) {
      return reply.code(400).send({ error: `user '${user.username}' cannot be deactivated` });
    }

    let roles = user.roles;
    if (request.body.roles !== undefined) {
      const validated = validateRoles(request.body.roles);
      if (!validated) {
        return reply.code(400).send({ error: "roles must only contain known role names", allowed: [...ALLOWED_ROLES] });
      }
      roles = validated;
    }

    const passwordHash = request.body.password ? await hashPassword(request.body.password) : user.password_hash;
    const displayName = request.body.display_name ?? user.display_name;
    const active = request.body.active ?? user.active;

    const result = await pool.query<UserRow>(
      `UPDATE users SET password_hash = $1, display_name = $2, roles = $3, active = $4, updated_at = now()
       WHERE id = $5 RETURNING *`,
      [passwordHash, displayName, roles, active, user.id],
    );
    return publicUser(result.rows[0]);
  });

  app.delete<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
    const user = await findUser(request.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    if (PROTECTED_USERNAMES.has(user.username)) {
      return reply.code(400).send({ error: `user '${user.username}' cannot be deleted` });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [user.id]);
    if (user.avatar_path) {
      await unlink(path.join(config.uploads.avatarsDir, user.avatar_path)).catch(() => {
        // Best-effort - a missing file on disk shouldn't block the delete.
      });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/users/:id/avatar", async (request, reply) => {
    const user = await findUser(request.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });

    const file: MultipartFile | undefined = await request.file({
      limits: { fileSize: config.uploads.avatarMaxSizeBytes },
    });
    if (!file) return reply.code(400).send({ error: "avatar file is required" });
    const extension = AVATAR_EXTENSIONS_BY_MIME_TYPE.get(file.mimetype);
    if (!extension) {
      return reply.code(400).send({ error: "avatar must be a PNG, JPEG, or WebP image" });
    }

    const buffer = await file.toBuffer();
    // @fastify/multipart truncates rather than throwing when a file exceeds
    // the configured limit - `.truncated` is how that's surfaced.
    if (file.file.truncated) {
      return reply.code(413).send({ error: "avatar exceeds the maximum allowed size" });
    }

    const filename = `${user.id}-${randomUUID()}.${extension}`;
    await writeFile(path.join(config.uploads.avatarsDir, filename), buffer);

    const previousAvatarPath = user.avatar_path;
    await pool.query("UPDATE users SET avatar_path = $1, updated_at = now() WHERE id = $2", [filename, user.id]);
    if (previousAvatarPath) {
      await unlink(path.join(config.uploads.avatarsDir, previousAvatarPath)).catch(() => {});
    }

    return { avatarUrl: `/uploads/avatars/${filename}` };
  });

  app.delete<{ Params: { id: string } }>("/users/:id/avatar", async (request, reply) => {
    const user = await findUser(request.params.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    if (!user.avatar_path) return reply.code(204).send();

    await pool.query("UPDATE users SET avatar_path = NULL, updated_at = now() WHERE id = $1", [user.id]);
    await unlink(path.join(config.uploads.avatarsDir, user.avatar_path)).catch(() => {});
    return reply.code(204).send();
  });
}
