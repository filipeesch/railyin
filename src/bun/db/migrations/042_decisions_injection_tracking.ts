import type { Database } from "bun:sqlite";

export const id = "042_decisions_injection_tracking";

export function up(db: Database): void {
  db.exec(
    `ALTER TABLE conversations ADD COLUMN decisions_injected_after_compaction_id INTEGER NULL`,
  );
}

export function down(db: Database): void {
  // SQLite does not support DROP COLUMN before 3.35; this is a no-op for rollback.
  void db;
}
