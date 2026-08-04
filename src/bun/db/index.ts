import type { Database } from "bun:sqlite";
import { createDb, type CreatedDb, type Db } from "./db.ts";
import { loadDbConfig, type DbConfig } from "./db-config.ts";

let _config: DbConfig | null = null;
let _created: CreatedDb | null = null;

/** The resolved DB config (lazily loaded). */
export function getDbConfig(): DbConfig {
  if (!_config) _config = loadDbConfig();
  return _config;
}

/** Override the resolved config (tests only) — call before the first getDb(). */
export function _setDbConfigForTests(config: DbConfig): void {
  _config = config;
}

function ensureCreated(): CreatedDb {
  if (!_created) _created = createDb(getDbConfig());
  return _created;
}

/**
 * The async data-layer port. Sync-lazy: the client object is constructed on first
 * access (Postgres connects lazily on first query). Call `initDb()` at boot to
 * establish the connection eagerly and fail fast.
 */
export function getDb(): Db {
  return ensureCreated().db;
}

/**
 * The shared bun:sqlite handle backing the SQLite `Db`, or `null` for Postgres.
 * Used by the migration runner's SQLite path so it operates on the SAME database
 * (critical for `:memory:`).
 */
export function getSqliteMigrationHandle(): Database | null {
  return ensureCreated().sqliteHandle;
}

/** The effective SQLite file path (or ":memory:"); throws for Postgres. */
export function getDbPath(): string {
  const config = getDbConfig();
  if (config.driver !== "sqlite") {
    throw new Error("getDbPath() is only valid for the SQLite driver");
  }
  return config.path;
}

/** Establish the connection eagerly and fail fast (Postgres) at boot. */
export async function initDb(): Promise<Db> {
  const { db } = ensureCreated();
  if (db.driver === "postgres") {
    try {
      await db.rows("SELECT 1");
    } catch (err) {
      throw new Error(
        `Failed to connect to the configured PostgreSQL database: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return db;
}

/** Only for tests — closes and discards the current DB singleton. */
export function _resetForTests(): void {
  void _created?.db.close();
  _created = null;
  _config = null;
}

/** Only for tests — discards the singleton reference WITHOUT closing it. */
export function _softResetForTests(): void {
  _created = null;
  _config = null;
}
