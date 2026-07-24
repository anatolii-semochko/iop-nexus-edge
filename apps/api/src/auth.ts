import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";

// UI login only (AGENTS.md section 13). requireAuth/requireAdmin are the
// only two route guards in this codebase - every other route (devices,
// nodes, processes) is intentionally still unauthenticated, a separate,
// not-yet-started task.

const BCRYPT_COST = 10;

export interface JwtPayload {
  sub: number;
  username: string;
  roles: string[];
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "unauthorized" });
  }
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const payload = request.user as JwtPayload;
  if (!payload.roles.includes("admin")) {
    await reply.code(403).send({ error: "forbidden" });
  }
}
