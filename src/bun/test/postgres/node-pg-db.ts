/**
 * Test-only `Db` implementation backed by `postgres.js` instead of `Bun.SQL`.
 *
 * Production's `PostgresDb` (src/bun/db/db.ts) requires the real Bun runtime
 * (`Bun.SQL`), which cannot run under vitest/Node. This adapter satisfies the
 * exact same `Db` interface using `postgres.js` (whose API `Bun.SQL` was
 * modeled on — `sql.unsafe(text, params)` and `sql.begin(fn)` behave
 * identically), so the PostgreSQL-specific test tier can exercise real
 * production logic (the migration runner, `Dialect` fragments, baseline
 * schema) against a real Postgres testcontainer under Node.
 */
import type postgres from "postgres";
import type { Db, ExecResult } from "../../db/db.ts";
import type { Dialect } from "../../db/dialect.ts";
import { PostgresDialect } from "../../db/dialect.ts";

type Sql = postgres.Sql;

export class NodePgDb implements Db {
  readonly driver = "postgres" as const;
  readonly dialect: Dialect;

  constructor(private readonly sql: Sql) {
    this.dialect = new PostgresDialect();
  }

  async rows<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- postgres.js's `unsafe` param typing is stricter than our portable `unknown[]` seam.
    return (await this.sql.unsafe(text, params as any)) as unknown as T[];
  }

  async get<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await this.sql.unsafe(text, params as any)) as unknown as T[];
    return result[0];
  }

  async exec(text: string, params: readonly unknown[] = []): Promise<ExecResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await this.sql.unsafe(text, params as any)) as unknown as Array<Record<string, unknown>> & { count: number };
    return {
      rows: result,
      affectedRows: result.count,
      lastInsertRowid: null,
    };
  }

  async begin<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- postgres.js's TransactionSql type is more specific than our portable Sql alias.
    return this.sql.begin((tx: any) => fn(new NodePgDb(tx))) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}
