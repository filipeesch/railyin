import { Database } from "bun:sqlite";

export const id = "043_model_settings";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_settings (
      workspace_key       TEXT    NOT NULL,
      qualified_model_id  TEXT    NOT NULL,
      context_window      INTEGER,
      PRIMARY KEY (workspace_key, qualified_model_id)
    );
  `);
}
