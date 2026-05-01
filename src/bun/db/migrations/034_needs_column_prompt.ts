import type { Database } from "bun:sqlite";

export const id = "034_needs_column_prompt";

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE tasks ADD COLUMN needs_column_prompt INTEGER NOT NULL DEFAULT 0;
  `);
}
