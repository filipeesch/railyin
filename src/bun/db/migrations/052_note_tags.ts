import type { Database } from "bun:sqlite";

export const id = "052_note_tags";

export function up(db: Database): void {
  db.exec(`ALTER TABLE task_notes ADD COLUMN tags TEXT NULL`);
}

export function down(db: Database): void {
  db.exec(`ALTER TABLE task_notes DROP COLUMN tags`);
}
