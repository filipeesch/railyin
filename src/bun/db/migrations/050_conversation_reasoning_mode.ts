import type { Database } from "bun:sqlite";

export const id = "050_conversation_reasoning_mode";

export function up(db: Database): void {
  db.exec("ALTER TABLE conversations ADD COLUMN reasoning_mode_override TEXT NULL");
}
