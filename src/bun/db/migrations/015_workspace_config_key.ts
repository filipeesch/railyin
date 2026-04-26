import { Database } from "bun:sqlite";
import { hasColumn } from "./_utils.ts";

export const id = "015_workspace_config_key";

export function up(db: Database): void {
  if (!hasColumn(db, "workspaces", "config_key")) {
    db.exec("ALTER TABLE workspaces ADD COLUMN config_key TEXT");
  }
  db.run("UPDATE workspaces SET config_key = 'default' WHERE config_key IS NULL");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_config_key ON workspaces(config_key)");
}
