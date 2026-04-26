import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";

let _db: Database | null = null;

export function getDbPath(): string {
  // RAILYN_DB can be set to ":memory:" for tests or an explicit file path
  if (process.env.RAILYN_DB) return process.env.RAILYN_DB;
  const dataDir = process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "railyn.db");
}

export function getDb(): Database {
  if (!_db) {
    _db = new Database(getDbPath(), { create: true });
    _db.exec("PRAGMA journal_mode = WAL;");
    _db.exec("PRAGMA busy_timeout = 5000;");
    _db.exec("PRAGMA foreign_keys = ON;");
  }
  return _db;
}

/** Only for tests — closes and discards the current DB singleton. */
export function _resetForTests(): void {
  _db?.close();
  _db = null;
}
