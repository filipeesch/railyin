import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Dialect } from "./dialect.ts";
import { createDialect } from "./dialect.ts";
import type { DbConfig, DbDriver } from "./db-config.ts";

/** Result of a write (INSERT/UPDATE/DELETE) or a RETURNING query. */
export interface ExecResult {
  /** Rows returned by a RETURNING clause (empty for plain writes). */
  rows: unknown[];
  /** Number of rows affected. */
  affectedRows: number;
  /** Generated rowid for SQLite inserts; `null` on Postgres (use RETURNING instead). */
  lastInsertRowid: number | null;
}

/**
 * The async data-layer port. Two implementations back it: `SqliteDb` (over
 * `bun:sqlite`) and `PostgresDb` (over `Bun.SQL`). All queries use `$1`
 * positional placeholders and pass parameters as a values array — parameters are
 * always BOUND, never interpolated, despite the `unsafe`-style backing on Postgres.
 */
export interface Db {
  readonly driver: DbDriver;
  readonly dialect: Dialect;
  /** Run a query and return all rows. */
  rows<T = unknown>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run a query and return the first row, or `undefined`. */
  get<T = unknown>(text: string, params?: readonly unknown[]): Promise<T | undefined>;
  /** Run a write (or RETURNING) statement. */
  exec(text: string, params?: readonly unknown[]): Promise<ExecResult>;
  /** Run `fn` inside a transaction; commit on resolve, roll back on throw. */
  begin<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /** Close the underlying connection(s). */
  close(): Promise<void>;
}

// ─── SQLite adapter (bun:sqlite-backed) ───────────────────────────────────────

const READ_OR_RETURNING = /^\s*(SELECT|WITH)\b|RETURNING\b/i;

/** Translate `$1`-style positional placeholders to bun:sqlite `?`, preserving order and reuse. */
function toSqlitePositional(text: string, params: readonly unknown[]): { text: string; args: unknown[] } {
  const args: unknown[] = [];
  const out = text.replace(/\$(\d+)/g, (_m, digits: string) => {
    const idx = Number(digits) - 1;
    args.push(params[idx]);
    return "?";
  });
  return { text: out, args };
}

export class SqliteDb implements Db {
  readonly driver = "sqlite" as const;
  private savepointDepth = 0;

  constructor(
    /** The shared bun:sqlite handle — also used by the SQLite migration path. */
    readonly raw: Database,
    readonly dialect: Dialect,
  ) {}

  async rows<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const { text: sql, args } = toSqlitePositional(text, params);
    return this.raw.query(sql).all(...(args as never[])) as T[];
  }

  async get<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const { text: sql, args } = toSqlitePositional(text, params);
    return (this.raw.query(sql).get(...(args as never[])) as T | null) ?? undefined;
  }

  async exec(text: string, params: readonly unknown[] = []): Promise<ExecResult> {
    const { text: sql, args } = toSqlitePositional(text, params);
    const stmt = this.raw.query(sql);
    if (READ_OR_RETURNING.test(text)) {
      const rows = stmt.all(...(args as never[]));
      return { rows, affectedRows: rows.length, lastInsertRowid: null };
    }
    const info = stmt.run(...(args as never[]));
    return {
      rows: [],
      affectedRows: info.changes,
      lastInsertRowid: info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null,
    };
  }

  async begin<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // Manual transaction control: bun:sqlite's `.transaction()` runs its callback
    // synchronously and cannot await an async body, so we drive BEGIN/COMMIT
    // ourselves on the same (single-threaded, synchronous) connection. Nested
    // calls use SAVEPOINTs.
    const nested = this.savepointDepth > 0;
    const name = `sp_${this.savepointDepth}`;
    this.savepointDepth++;
    this.raw.exec(nested ? `SAVEPOINT ${name}` : "BEGIN");
    try {
      const result = await fn(this);
      this.raw.exec(nested ? `RELEASE ${name}` : "COMMIT");
      return result;
    } catch (err) {
      this.raw.exec(nested ? `ROLLBACK TO ${name}` : "ROLLBACK");
      throw err;
    } finally {
      this.savepointDepth--;
    }
  }

  async close(): Promise<void> {
    this.raw.close();
  }
}

// ─── Postgres adapter (Bun.SQL-backed) ────────────────────────────────────────

export class PostgresDb implements Db {
  readonly driver = "postgres" as const;

  constructor(
    readonly sql: SQL,
    readonly dialect: Dialect,
  ) {}

  async rows<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.sql.unsafe(text, params as unknown[])) as T[];
  }

  async get<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T | undefined> {
    const result = (await this.sql.unsafe(text, params as unknown[])) as T[];
    return result[0];
  }

  async exec(text: string, params: readonly unknown[] = []): Promise<ExecResult> {
    const result = (await this.sql.unsafe(text, params as unknown[])) as unknown[];
    const meta = result as unknown as { count?: number };
    return {
      rows: result,
      affectedRows: typeof meta.count === "number" ? meta.count : result.length,
      lastInsertRowid: null,
    };
  }

  async begin<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.sql.begin((tx: SQL) => fn(new PostgresDb(tx, this.dialect))) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.sql.close();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreatedDb {
  db: Db;
  /** The shared bun:sqlite handle when the driver is SQLite; `null` for Postgres. */
  sqliteHandle: Database | null;
}

/** Create a `Db` for the resolved config. Postgres connects lazily/asynchronously on first query. */
export function createDb(config: DbConfig): CreatedDb {
  if (config.driver === "postgres") {
    const sql = new SQL({
      url: config.url,
      ...(config.pool?.max !== undefined ? { max: config.pool.max } : {}),
      ...(config.pool?.idleTimeout !== undefined ? { idleTimeout: config.pool.idleTimeout } : {}),
    });
    return { db: new PostgresDb(sql, createDialect("postgres")), sqliteHandle: null };
  }

  if (config.path !== ":memory:") {
    mkdirSync(dirname(config.path), { recursive: true });
  }
  const raw = new Database(config.path, { create: true });
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA busy_timeout = 5000;");
  raw.exec("PRAGMA foreign_keys = ON;");
  return { db: new SqliteDb(raw, createDialect("sqlite")), sqliteHandle: raw };
}
