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

// Track every open Database so we can close them inside vitest's afterAll()
// hook — while V8 is still fully operational — before process teardown begins.
//
// DO NOT register process.on("exit") or parentPort.once("close") hooks here.
// Those fire during or after Node.js teardown, racing with better-sqlite3's
// native C++ finalizers.  If our closeAll() runs after the native addon has
// already started freeing its objects, calling db.close() segfaults on macOS.
// The vitest-teardown.ts setupFile registers afterAll(closeAll) which fires at
// the right time; better-sqlite3's own AddEnvironmentCleanupHook handles any
// remaining connections on process exit.
//
// IMPORTANT: Use globalThis to store the Set so it persists across module
// reloads.  Stryker forces pool:'threads' with reloadEnvironment:true, which
// clears the module registry between test files within the same worker thread.
// Without globalThis, each module generation gets its OWN empty Set, and the
// closeAll() captured by vitest-teardown.ts operates on a stale (empty) Set —
// leaving the new generation's connections unclosed at V8 isolate teardown.
const _g = globalThis as Record<string, unknown>;
if (!(_g.__openSqliteDbs instanceof Set)) {
  _g.__openSqliteDbs = new Set<Database>();
}
const _openDatabases = _g.__openSqliteDbs as Set<Database>;

export function closeAll(): void {
  for (const db of _openDatabases) {
    try { db.close(); } catch { /* already closed */ }
  }
  _openDatabases.clear();
}

interface QueryResult<T> {
  get(...params: BindValue[]): T | null;
  all(...params: BindValue[]): T[];
  run(...params: BindValue[]): void;
}

export class Database {
  private _db: BetterSqlite3.Database;

  constructor(path: string, options?: { create?: boolean; readonly?: boolean }) {
    this._db = new BetterSqlite3(path, { readonly: options?.readonly ?? false });
    _openDatabases.add(this);
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
    _openDatabases.delete(this);
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
