/**
 * `Db` port test double (TH-3). Records every SQL text + params it receives
 * and returns caller-primed canned rows, enabling pure-unit tests of query
 * shape, parameter binding, and row mapping without a real database.
 */
import type { Db, ExecResult } from "../../db/db.ts";
import { SqliteDialect } from "../../db/dialect.ts";

export interface FakeDbCall {
  op: "rows" | "get" | "exec";
  text: string;
  params: readonly unknown[];
}

export class FakeDb implements Db {
  readonly driver = "sqlite" as const;
  readonly dialect = new SqliteDialect();
  readonly calls: FakeDbCall[] = [];

  /** Queue of canned row-sets returned by successive `rows`/`get` calls, FIFO. */
  private rowQueue: unknown[][] = [];
  /** Queue of canned exec results, FIFO. Defaults to an empty-write result when exhausted. */
  private execQueue: ExecResult[] = [];

  /** Prime the next `rows`/`get` call's return value. */
  primeRows(rows: unknown[]): this {
    this.rowQueue.push(rows);
    return this;
  }

  /** Prime the next `exec` call's return value. */
  primeExec(result: Partial<ExecResult>): this {
    this.execQueue.push({ rows: [], affectedRows: 0, lastInsertRowid: null, ...result });
    return this;
  }

  async rows<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ op: "rows", text, params });
    return (this.rowQueue.shift() ?? []) as T[];
  }

  async get<T = unknown>(text: string, params: readonly unknown[] = []): Promise<T | undefined> {
    this.calls.push({ op: "get", text, params });
    const rows = this.rowQueue.shift() ?? [];
    return rows[0] as T | undefined;
  }

  async exec(text: string, params: readonly unknown[] = []): Promise<ExecResult> {
    this.calls.push({ op: "exec", text, params });
    return this.execQueue.shift() ?? { rows: [], affectedRows: 0, lastInsertRowid: null };
  }

  async begin<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}
}
