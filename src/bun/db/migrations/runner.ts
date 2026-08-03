import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDbConfig, getDbPath, getDb, getSqliteMigrationHandle } from "../index.ts";
import type { Db } from "../db.ts";

/** Minimal logger the runner writes to (defaults to console). */
export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

const consoleLogger: MigrationLogger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
};

export interface Migration {
  readonly id: string;
  readonly managesTransaction?: boolean;
  /** Old checksums for this file — accepted for known-bugfix amendments. */
  readonly previousChecksums?: readonly string[];
  up(db: Database): void;
}

/** A PostgreSQL migration — async, runs through the `Db` port. */
export interface PostgresMigration {
  readonly id: string;
  up(db: Db): Promise<void>;
}

// import.meta.dir is Bun-only; fall back to import.meta.dirname (Node 20.11+)
const MIGRATIONS_DIR = (import.meta as { dir?: string }).dir ?? import.meta.dirname;
const PG_MIGRATIONS_DIR = join(MIGRATIONS_DIR, "..", "migrations-postgres");

function checksumOf(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runMigrations(opts: { logger?: MigrationLogger } = {}): Promise<void> {
  const logger = opts.logger ?? consoleLogger;
  if (getDbConfig().driver === "postgres") {
    await runPostgresMigrations(getDb(), logger);
  } else {
    const handle = getSqliteMigrationHandle();
    if (!handle) throw new Error("SQLite migration handle unavailable");
    await runSqliteMigrations(handle, logger);
  }
}

// ─── SQLite path (bun:sqlite, sync, checksum-guarded) ─────────────────────────

async function discoverMigrations(): Promise<
  Array<{ filename: string; filePath: string; migration: Migration; checksum: string }>
> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "runner.ts" && !f.startsWith("_"))
    .sort();

  const result: Array<{ filename: string; filePath: string; migration: Migration; checksum: string }> = [];
  for (const filename of files) {
    const filePath = join(MIGRATIONS_DIR, filename);
    const migration = (await import(filePath)) as Migration;
    const checksum = checksumOf(filePath);
    result.push({ filename, filePath, migration, checksum });
  }
  return result;
}

function validateMigrations(entries: Array<{ filename: string; migration: Migration }>): void {
  const seenIds = new Map<string, string>();
  for (const { filename, migration } of entries) {
    if (seenIds.has(migration.id)) {
      throw new Error(
        `Duplicate migration ID "${migration.id}" found in: ${seenIds.get(migration.id)} and ${filename}`,
      );
    }
    seenIds.set(migration.id, filename);
  }

  const ids = entries.map((e) => e.migration.id);
  const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== sortedIds[i]) {
      throw new Error(
        `Migration file sort order does not match ID sort order at position ${i}: ` +
          `filename order yields ID "${ids[i]}" but sorted-ID order expects "${sortedIds[i]}". ` +
          `Rename the file so its sort position matches the ID's lexicographic position.`,
      );
    }
  }
}

function bootstrapMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT;");
  } catch {
    // Column already exists — ignore
  }
}

function loadApplied(db: Database): Map<string, string | null> {
  const rows = db
    .query<{ id: string; checksum: string | null }, []>("SELECT id, checksum FROM schema_migrations")
    .all();
  return new Map(rows.map((r) => [r.id, r.checksum]));
}

function backupDb(logger: MigrationLogger): void {
  const dbPath = getDbPath();
  if (dbPath === ":memory:") return;
  try {
    copyFileSync(dbPath, `${dbPath}.backup`);
    logger.info(`[db] Backup created: ${dbPath}.backup`);
  } catch (err) {
    logger.warn(`[db] Backup failed (non-fatal): ${err}`);
  }
}

function backfillChecksums(db: Database, byId: Map<string, { checksum: string }>): void {
  const nullRows = db
    .query<{ id: string }, []>("SELECT id FROM schema_migrations WHERE checksum IS NULL")
    .all();
  for (const { id } of nullRows) {
    const entry = byId.get(id);
    if (entry) {
      db.run("UPDATE schema_migrations SET checksum = ? WHERE id = ?", [entry.checksum, id]);
    }
  }
}

async function runSqliteMigrations(db: Database, logger: MigrationLogger): Promise<void> {
  bootstrapMigrationsTable(db);

  const entries = await discoverMigrations();
  validateMigrations(entries);

  const applied = loadApplied(db);
  const byId = new Map(entries.map((e) => [e.migration.id, e]));

  for (const [id, storedChecksum] of applied) {
    if (storedChecksum === null) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    if (entry.checksum !== storedChecksum) {
      const prev = entry.migration.previousChecksums;
      if (prev && prev.includes(storedChecksum)) {
        logger.warn(
          `[db] Migration "${id}" was amended after being applied (known bugfix). ` +
            `Updating stored checksum from ${storedChecksum} to ${entry.checksum}.`,
        );
        db.run("UPDATE schema_migrations SET checksum = ? WHERE id = ?", [entry.checksum, id]);
        continue;
      }
      throw new Error(
        `Checksum mismatch for migration "${id}": stored ${storedChecksum}, file ${entry.checksum}. ` +
          `Migration files must not be modified after being applied to a database.`,
      );
    }
  }

  const pending = entries.filter((e) => !applied.has(e.migration.id));
  if (pending.length === 0) {
    backfillChecksums(db, byId);
    return;
  }

  backupDb(logger);

  for (const { migration, checksum } of pending) {
    try {
      if (migration.managesTransaction) {
        migration.up(db);
      } else {
        db.transaction(() => {
          migration.up(db);
          db.run("INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)", [migration.id, checksum]);
        })();
      }
      logger.info(`[db] Applied migration: ${migration.id}`);
    } catch (error) {
      logger.warn(`[db] Failed to apply migration: ${migration.id}`);
      logger.warn(`[db] Error: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) logger.warn(error.stack);
      logger.warn(`[db] Rolling back and exiting...`);
      process.exit(1);
    }
  }

  backfillChecksums(db, byId);
}

// ─── PostgreSQL path (Bun.SQL, async) ─────────────────────────────────────────

async function discoverPostgresMigrations(): Promise<Array<{ migration: PostgresMigration; checksum: string }>> {
  const files = readdirSync(PG_MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .sort();
  const result: Array<{ migration: PostgresMigration; checksum: string }> = [];
  for (const filename of files) {
    const filePath = join(PG_MIGRATIONS_DIR, filename);
    const migration = (await import(filePath)) as PostgresMigration;
    result.push({ migration, checksum: checksumOf(filePath) });
  }
  return result;
}

async function runPostgresMigrations(db: Db, logger: MigrationLogger): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id         text PRIMARY KEY,
       applied_at text NOT NULL DEFAULT (to_char((now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS')),
       checksum   text
     )`,
  );

  const appliedRows = await db.rows<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.id));

  const entries = await discoverPostgresMigrations();
  const pending = entries.filter((e) => !applied.has(e.migration.id));
  if (pending.length === 0) return;

  // PostgreSQL file backup does not apply — external backup (pg_dump) is the operator's responsibility.
  logger.info("[db] PostgreSQL detected — file backup not applicable (use pg_dump for backups).");

  for (const { migration, checksum } of pending) {
    try {
      await db.begin(async (tx) => {
        await migration.up(tx);
        await tx.exec("INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)", [migration.id, checksum]);
      });
      logger.info(`[db] Applied migration: ${migration.id}`);
    } catch (error) {
      logger.warn(`[db] Failed to apply migration: ${migration.id}`);
      logger.warn(`[db] Error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
