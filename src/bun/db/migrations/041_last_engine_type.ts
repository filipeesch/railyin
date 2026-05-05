import type { Database } from "bun:sqlite";

export const id = "041_last_engine_type";

export function up(db: Database): void {
  // Guard against re-application (SQLite lacks ADD COLUMN IF NOT EXISTS)
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(conversations)").all();
  if (cols.some((c) => c.name === "last_engine_type")) return;
  db.run(`ALTER TABLE conversations ADD COLUMN last_engine_type TEXT NULL`);
}
