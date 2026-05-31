import type { Database } from "bun:sqlite";

export const id = "047_conversation_sampling_preset";

export function up(db: Database): void {
  db.exec("ALTER TABLE conversations ADD COLUMN sampling_preset_override TEXT NULL");
}

export function down(db: Database): void {
  // SQLite does not support DROP COLUMN in older versions — intentionally left as no-op.
  // The column is nullable and ignored by old code, so rollback is safe without removal.
}
