import type { FastifyInstance } from "fastify";

import { requireAuth, verifyPassword, type JwtPayload } from "../auth.js";
import { config } from "../config.js";
import { pool } from "../db.js";

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
  return rest;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { username: string; password: string } }>("/auth/login", async (request, reply) => {
    const username = request.body.username?.trim().toLowerCase();
    const { password } = request.body;
    if (!username || !password) {
      return reply.code(400).send({ error: "username and password are required" });
    }

    const result = await pool.query<UserRow>("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];
    // Same generic message whether the username doesn't exist, the user is
    // deactivated, or the password is wrong - not revealing which is true.
    if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: "invalid username or password" });
    }

    const payload: JwtPayload = { sub: user.id, username: user.username, roles: user.roles };
    const token = app.jwt.sign(payload, { expiresIn: config.auth.tokenTtl });
    // No explicit maxAge/expires - a session cookie, cleared when the
    // browser closes. The token's own signed `exp` claim (config.auth.
    // tokenTtl) is what actually bounds the session server-side via
    // jwtVerify() in requireAuth; the cookie lifetime doesn't need to
    // duplicate that with a second, independently-parsed duration.
    reply.setCookie(config.auth.cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.auth.secureCookies,
      path: "/",
    });
    return { user: publicUser(user) };
  });

  app.post("/auth/logout", async (_request, reply) => {
    // Same attributes as the cookie was set with - clearing purely by name
    // still works in every browser, but matching them keeps this from ever
    // silently depending on a browser's mismatched-attribute fallback.
    reply.clearCookie(config.auth.cookieName, {
      path: "/",
      sameSite: "strict",
      secure: config.auth.secureCookies,
    });
    return { status: "ok" };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const payload = request.user as JwtPayload;
    const result = await pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [payload.sub]);
    const user = result.rows[0];
    if (!user || !user.active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { user: publicUser(user) };
  });
}
