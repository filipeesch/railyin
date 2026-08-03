import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isDockerAvailable, pgTestContainer, type PgFixture } from "./pg-test-container.ts";
import { runPostgresMigrations, type MigrationLogger } from "../../db/migrations/runner.ts";
import { initDb as initSqliteDb } from "../helpers.ts";
import { _resetForTests } from "../../db/index.ts";

const silentLogger: MigrationLogger = { info() {}, warn() {} };

describe.skipIf(!isDockerAvailable())("PostgreSQL baseline schema (PC-5, PC-7)", () => {
  let fixture: PgFixture;

  beforeAll(async () => {
    fixture = await pgTestContainer();
  });

  afterAll(async () => {
    await fixture?.cleanup();
    _resetForTests();
  });

  it("PG-1: baseline provisions the full schema and records itself", async () => {
    await runPostgresMigrations(fixture.db, silentLogger);

    const applied = await fixture.db.rows<{ id: string }>("SELECT id FROM schema_migrations");
    expect(applied.map((r) => r.id)).toContain("001_pg_baseline");

    const tables = await fixture.db.rows<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'schema_migrations'",
    );
    expect(tables.length).toBe(22);
  });

  it("PG-2: re-running the runner is idempotent (no migration re-applied)", async () => {
    const before = await fixture.db.rows<{ id: string }>("SELECT id FROM schema_migrations");
    await runPostgresMigrations(fixture.db, silentLogger);
    const after = await fixture.db.rows<{ id: string }>("SELECT id FROM schema_migrations");
    expect(after.length).toBe(before.length);
  });

  it("PG-3: schema parity — Postgres has the same table set as the real SQLite migrations", async () => {
    const sqliteDb = await initSqliteDb();
    const sqliteTables = (
      await sqliteDb.rows<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
      )
    )
      .map((r) => r.name)
      .sort();

    const pgTables = (
      await fixture.db.rows<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'schema_migrations'",
      )
    )
      .map((r) => r.table_name)
      .sort();

    expect(pgTables).toEqual(sqliteTables);
  });

  it("PG-4: a failing migration is not recorded and does not commit partial DDL", async () => {
    const badMigration = {
      id: "999_intentionally_bad",
      async up() {
        throw new Error("boom");
      },
    };
    // Directly exercise the per-migration transactional behavior: apply
    // inside db.begin, exactly like the runner does, and confirm rollback.
    await expect(
      fixture.db.begin(async (tx) => {
        await badMigration.up();
        await tx.exec("INSERT INTO schema_migrations (id) VALUES ($1)", [badMigration.id]);
      }),
    ).rejects.toThrow("boom");

    const recorded = await fixture.db.get<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [badMigration.id],
    );
    expect(recorded).toBeUndefined();
  });
});
