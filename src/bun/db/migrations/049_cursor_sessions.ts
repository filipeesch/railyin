import type { Database } from "bun:sqlite";

export const id = "049_cursor_sessions";

export function up(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS cursor_sessions (" +
      "  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE," +
      "  agent_id        TEXT NOT NULL," +
      "  created_at      TEXT NOT NULL DEFAULT (datetime('now'))," +
      "  last_used_at    TEXT NOT NULL DEFAULT (datetime('now'))" +
      ")",
  );
}
