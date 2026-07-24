import bcrypt from "bcryptjs";
import type { MigrationBuilder } from "node-pg-migrate";

// Two protected accounts required by AGENTS.md section 13 - `admin` (never
// deletable, never deactivatable) and `system` (never deletable, may be
// deactivated). Passwords come from env (ADMIN_DEFAULT_PASSWORD /
// SYSTEM_DEFAULT_PASSWORD, see .env.example) and are hashed here at
// migration time, same "no hardcoded config/secrets in code" rule as every
// other credential in this repo (POSTGRES_PASSWORD, RABBITMQ_DEFAULT_PASS) -
// not a stronger generated-random-password scheme, for consistency with
// those. Change both in any real deployment.
const BCRYPT_COST = 10;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const up = async (pgm: MigrationBuilder): Promise<void> => {
  const adminHash = await bcrypt.hash(requiredEnv("ADMIN_DEFAULT_PASSWORD"), BCRYPT_COST);
  const systemHash = await bcrypt.hash(requiredEnv("SYSTEM_DEFAULT_PASSWORD"), BCRYPT_COST);

  pgm.sql(
    `INSERT INTO users (username, password_hash, display_name, roles, active)
     VALUES
       ('admin', '${adminHash}', 'Administrator', '{admin}', true),
       ('system', '${systemHash}', 'System', '{}', true)`,
  );
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DELETE FROM users WHERE username IN ('admin', 'system')`);
};
