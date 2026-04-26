import { Database } from "bun:sqlite";

export const id = "005_enabled_models";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS enabled_models (
      workspace_id        INTEGER NOT NULL,
      qualified_model_id  TEXT    NOT NULL,
      PRIMARY KEY (workspace_id, qualified_model_id)
    );
  `);
}
