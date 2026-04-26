import { Database } from "bun:sqlite";

export const id = "008_hunk_decisions_sent";

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE task_hunk_decisions ADD COLUMN sent          INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE task_hunk_decisions ADD COLUMN original_end  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE task_hunk_decisions ADD COLUMN modified_end  INTEGER NOT NULL DEFAULT 0;
  `);
}
