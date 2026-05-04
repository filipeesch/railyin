import type { Database } from "bun:sqlite";

export const id = "035_add_model_to_conversations";

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE conversations ADD COLUMN model TEXT NULL;
  `);
}

export function down(db: Database): void {
  db.exec(`
    ALTER TABLE conversations DROP COLUMN model;
  `);
}