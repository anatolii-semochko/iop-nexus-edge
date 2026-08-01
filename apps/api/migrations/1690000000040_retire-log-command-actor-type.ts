import type { MigrationBuilder } from "node-pg-migrate";

// The "system" user (routes/users.ts's own protected, non-deletable
// service account, seeded by migration 1690000000009) IS the orchestrator
// (AGENTS_TO_DO.md, 2026-08-01, direct instruction: "У нас є завжди
// користувач по замовчуванню - system. Це і є оркестратор."). Every
// orchestrator-issued command now attributes to this real user row -
// `actor_type`'s separate "orchestrator" synthetic actor (added one
// migration ago, 1690000000039) turns out to be exactly what "system"
// already existed to represent, so it's retired here rather than kept
// alongside a redundant concept.
export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
    UPDATE log_command
    SET actor_user_id = (SELECT id FROM users WHERE username = 'system')
    WHERE actor_type = 'orchestrator'
  `);

  pgm.dropConstraint("log_command", "log_command_actor_type_check");
  pgm.dropColumn("log_command", "actor_type");
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.addColumn("log_command", { actor_type: { type: "text" } });
  pgm.sql(`
    UPDATE log_command l
    SET actor_type = CASE WHEN u.username = 'system' THEN 'orchestrator' ELSE 'user' END
    FROM users u
    WHERE u.id = l.actor_user_id
  `);
  pgm.sql(`UPDATE log_command SET actor_type = 'user' WHERE actor_type IS NULL`);
  pgm.alterColumn("log_command", "actor_type", { notNull: true });
  pgm.addConstraint("log_command", "log_command_actor_type_check", "CHECK (actor_type in ('user', 'orchestrator'))");
};
