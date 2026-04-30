/**
 * Compatibility shim: makes the bun:sqlite API available when running under
 * Vite/vitest (Stryker mutation runs).  The shim wraps better-sqlite3, which
 * has an almost-identical API to bun:sqlite but is a standard npm package
 * resolvable by the Vite bundler.
 *
 * This file is only referenced via the `resolve.alias` in
 * vitest.backend.config.ts — production code always uses the real bun:sqlite.
 */
import BetterSqlite3 from "better-sqlite3";

type BindValue = string | number | bigint | Buffer | null;

interface QueryResult<T> {
  get(...params: BindValue[]): T | null;
  all(...params: BindValue[]): T[];
  run(...params: BindValue[]): void;
}

export class Database {
  private _db: BetterSqlite3.Database;

  constructor(path: string, options?: { create?: boolean; readonly?: boolean }) {
    this._db = new BetterSqlite3(path, { readonly: options?.readonly ?? false });
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  /** bun:sqlite's run() returns { changes, lastInsertRowid }. Accepts both
   *  db.run(sql, [a, b, c]) and db.run(sql, a, b, c) calling conventions. */
  run(sql: string, ...params: BindValue[] | [BindValue[]]): { changes: number; lastInsertRowid: number } {
    const args = params.length === 1 && Array.isArray(params[0]) ? params[0] : (params as BindValue[]);
    const result = this._db.prepare(sql).run(...args);
    return {
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    };
  }

  /** bun:sqlite's query() returns a prepared statement with get/all/run */
  query<T = Record<string, unknown>, _P = unknown>(sql: string): QueryResult<T> {
    const stmt = this._db.prepare(sql);
    return {
      get: (...params: BindValue[]) => (stmt.get(...params) as T) ?? null,
      all: (...params: BindValue[]) => stmt.all(...params) as T[],
      run: (...params: BindValue[]) => { stmt.run(...params); },
    };
  }

  prepare(sql: string): BetterSqlite3.Statement {
    return this._db.prepare(sql);
  }

  close(): void {
    this._db.close();
  }

  get inTransaction(): boolean {
    return this._db.inTransaction;
  }

  /** bun:sqlite returns a callable transaction function, as does better-sqlite3 */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return this._db.transaction(fn) as unknown as (...args: unknown[]) => T;
  }
}

// Re-export Statement as an opaque type alias so `import type { Statement }`
// from bun:sqlite compiles without errors.
export type Statement = BetterSqlite3.Statement;
