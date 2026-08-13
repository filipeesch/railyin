import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync } from "fs";
import { getDataDir } from "../utils/platform.ts";

let _db: Database | null = null;

export function getDbPath(): string {
  // RAILYN_DB can be set to ":memory:" for tests or an explicit file path
  if (process.env.RAILYN_DB) return process.env.RAILYN_DB;
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "railyn.db");
}

export function getDb(): Database {
  if (!_db) {
    _db = new Database(getDbPath(), { create: true });
    _db.exec("PRAGMA journal_mode = WAL;");
    // Long busy timeout: multi-process setups (several servers on one DB) can
    // hold the write lock for seconds during checkpoints/batch flushes. 20s is
    // a deliberate tradeoff — a contended write may block the event loop that
    // long, but SQLITE_BUSY after the wait is treated as a genuine failure.
    _db.exec("PRAGMA busy_timeout = 20000;");
    // WAL-safe companion settings: NORMAL skips the per-commit fsync (power
    // loss may lose recent commits, never corrupts), journal_size_limit bounds
    // WAL growth so checkpoints stay cheap under sustained write load.
    _db.exec("PRAGMA synchronous = NORMAL;");
    _db.exec("PRAGMA journal_size_limit = 67108864;");
    _db.exec("PRAGMA foreign_keys = ON;");
  }
  return _db;
}

/** Only for tests — closes and discards the current DB singleton. */
export function _resetForTests(): void {
  _db?.close();
  _db = null;
}

/** Only for tests — discards the singleton reference WITHOUT closing it.
 *  Use when background buffers (WriteBuffer) still hold the old
 *  db reference and may flush after the test completes. The old in-memory db
 *  will be garbage-collected once all references are dropped. */
export function _softResetForTests(): void {
  _db = null;
}
