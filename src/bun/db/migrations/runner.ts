import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, getDbPath } from "../index.ts";

export interface Migration {
  readonly id: string;
  readonly managesTransaction?: boolean;
  up(db: Database): void;
}

const MIGRATIONS_DIR = import.meta.dir;

function checksumOf(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

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
  // Validate no duplicate IDs
  const seenIds = new Map<string, string>();
  for (const { filename, migration } of entries) {
    if (seenIds.has(migration.id)) {
      throw new Error(
        `Duplicate migration ID "${migration.id}" found in: ${seenIds.get(migration.id)} and ${filename}`,
      );
    }
    seenIds.set(migration.id, filename);
  }

  // Validate filename sort order matches ID lexicographic sort order
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
  // Add checksum column on first upgrade (pre-existing DBs lack it)
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

function backupDb(): void {
  const dbPath = getDbPath();
  if (dbPath === ":memory:") return;
  try {
    copyFileSync(dbPath, `${dbPath}.backup`);
    console.log("[db] Backup created:", `${dbPath}.backup`);
  } catch (err) {
    console.warn("[db] Backup failed (non-fatal):", err);
  }
}

function backfillChecksums(
  db: Database,
  byId: Map<string, { checksum: string }>,
): void {
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

export async function runMigrations(): Promise<void> {
  const db = getDb();
  bootstrapMigrationsTable(db);

  const entries = await discoverMigrations();
  validateMigrations(entries);

  const applied = loadApplied(db);
  const byId = new Map(entries.map((e) => [e.migration.id, e]));

  // Validate checksums of already-applied migrations (fail on tamper)
  for (const [id, storedChecksum] of applied) {
    if (storedChecksum === null) continue; // legacy row without checksum — skip
    const entry = byId.get(id);
    if (!entry) continue; // file removed after apply — skip
    if (entry.checksum !== storedChecksum) {
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

  backupDb();

  for (const { migration, checksum } of pending) {
    if (migration.managesTransaction) {
      // Migration owns its transaction lifecycle and inserts its own schema_migrations row.
      migration.up(db);
    } else {
      db.transaction(() => {
        migration.up(db);
        db.run("INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)", [migration.id, checksum]);
      })();
    }
    console.log(`[db] Applied migration: ${migration.id}`);
  }

  // Backfill checksums for managesTransaction migrations that inserted (id, NULL)
  backfillChecksums(db, byId);
}
