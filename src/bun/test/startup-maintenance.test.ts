import { describe, it, expect, afterEach } from "vitest";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StartupMaintenance } from "../db/startup-maintenance.ts";

let tempDir: string;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

function makeDb(): { db: Database; dbPath: string } {
  tempDir = mkdtempSync(join(tmpdir(), "railyn-maintenance-"));
  const dbPath = join(tempDir, "test.db");
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  return { db, dbPath };
}

function insertRows(db: Database, count: number, size = 100): void {
  const insert = db.prepare("INSERT INTO t (v) VALUES (?)");
  for (let i = 0; i < count; i++) insert.run(`row-${i}-${"x".repeat(size)}`);
}

function pageCount(db: Database): number {
  return db.query<{ page_count: number }, []>("PRAGMA page_count").get()!.page_count;
}

// ─── SM-1: backup ─────────────────────────────────────────────────────────────

describe("StartupMaintenance — SM-1: backup", () => {
  it("creates a consistent, compacted snapshot and logs it", () => {
    const { db, dbPath } = makeDb();
    insertRows(db, 500);

    const logs: string[] = [];
    const m = new StartupMaintenance(db, dbPath, { log: (msg) => logs.push(msg) });
    m.backup();

    expect(logs.some((l) => l.includes("[db] Backup created:"))).toBe(true);
    expect(existsSync(`${dbPath}.backup`)).toBe(true);

    const backup = new Database(`${dbPath}.backup`, { readonly: true });
    const rows = backup.query<{ c: number }, []>("SELECT COUNT(*) c FROM t").get()!.c;
    backup.close();
    expect(rows).toBe(500);
  });

  it("overwrites a stale snapshot", () => {
    const { db, dbPath } = makeDb();
    insertRows(db, 10);

    const m = new StartupMaintenance(db, dbPath);
    m.backup();
    const size1 = statSync(`${dbPath}.backup`).size;
    insertRows(db, 200);

    m.backup(); // must not fail — stale snapshot is removed first
    const size2 = statSync(`${dbPath}.backup`).size;
    expect(size2).toBeGreaterThan(size1);
  });

  it("is a no-op for in-memory databases", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    const m = new StartupMaintenance(db, ":memory:");
    expect(() => m.backup()).not.toThrow();
    expect(() => m.compact()).not.toThrow();
    db.close();
  });

  it("never throws when the backup target is invalid", () => {
    const { db, dbPath } = makeDb();
    const warnings: string[] = [];
    const m = new StartupMaintenance(db, dbPath, {
      backupPath: join(tempDir, "no-such-dir", "backup.db"), // parent does not exist
      warn: (msg) => warnings.push(msg),
    });

    expect(() => m.backup()).not.toThrow();
    expect(warnings.some((w) => w.includes("Backup failed"))).toBe(true);
  });
});

// ─── SM-2: compaction ─────────────────────────────────────────────────────────

describe("StartupMaintenance — SM-2: compaction", () => {
  it("reclaims free pages above the thresholds", () => {
    const { db, dbPath } = makeDb();
    insertRows(db, 5000, 200);
    db.run("DELETE FROM t WHERE id % 3 != 0"); // delete ~2/3 of rows
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = pageCount(db);

    const logs: string[] = [];
    const m = new StartupMaintenance(db, dbPath, {
      freeSpaceThresholdBytes: 0,
      freeSpaceRatioThreshold: 0,
      log: (msg) => logs.push(msg),
    });
    m.compact();

    const after = pageCount(db);
    expect(after).toBeLessThan(before);
    expect(logs.some((l) => l.includes("reclaimed"))).toBe(true);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("skips the full VACUUM when free space is negligible", () => {
    const { db, dbPath } = makeDb();
    insertRows(db, 100);
    db.run("DELETE FROM t WHERE id <= 5");

    const logs: string[] = [];
    const m = new StartupMaintenance(db, dbPath, { log: (msg) => logs.push(msg) });
    m.compact();

    expect(logs.some((l) => l.includes("nothing to reclaim"))).toBe(true);
    // No full VACUUM ran — page layout untouched (only WAL checkpoint happened)
    expect(db.query<{ v: string }, []>("SELECT v FROM t LIMIT 1").get()).not.toBeNull();
  });

  it("never throws when the WAL checkpoint fails", () => {
    const { db, dbPath } = makeDb();
    insertRows(db, 10);
    const warnings: string[] = [];
    const m = new StartupMaintenance(db, dbPath, { warn: (msg) => warnings.push(msg) });

    // Force a checkpoint failure by wrapping exec for the checkpoint statement.
    const originalExec = db.exec.bind(db);
    let failNext = true;
    db.exec = ((sql: string) => {
      if (failNext && sql.includes("wal_checkpoint")) {
        failNext = false;
        throw new Error("database is locked");
      }
      return originalExec(sql) as unknown;
    }) as typeof db.exec;

    expect(() => m.compact()).not.toThrow();
    expect(warnings.some((w) => w.includes("WAL checkpoint failed"))).toBe(true);
  });
});
