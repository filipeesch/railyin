import type { Database } from "bun:sqlite";

export const id = "046_drop_notes_title";

export function up(db: Database): void {
  db.exec(`ALTER TABLE task_notes DROP COLUMN title`);
}

export function down(db: Database): void {
  db.exec(`ALTER TABLE task_notes ADD COLUMN title TEXT`);
}
