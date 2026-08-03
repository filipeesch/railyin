import type { DbDriver } from "./db-config.ts";

/**
 * Strategy that supplies the SQL fragments which differ between engines.
 *
 * Design choices that keep app-level SQL identical across engines (low churn):
 *  - Booleans are stored as INTEGER `0`/`1` on BOTH engines, so existing
 *    `is_deleted = 1` / `? 1 : 0` SQL is unchanged. `toDbBool`/`fromDbBool` exist
 *    for callers that want to be explicit.
 *  - Timestamp columns are TEXT on both engines; `now()` yields the same
 *    `YYYY-MM-DD HH:MM:SS` string shape.
 *  - Generated ids are 32-bit integers on both engines, so they come back as JS
 *    `number` (no bigint coercion needed).
 */
export interface Dialect {
  readonly kind: DbDriver;

  /** SQL expression for the current UTC timestamp as a `YYYY-MM-DD HH:MM:SS` string. */
  now(): string;

  /**
   * SQL expression extracting a (dotted) path from a JSON/JSONB text column.
   * e.g. `jsonExtract("metadata", "a.b")`.
   */
  jsonExtract(column: string, path: string): string;

  /** `RETURNING <idColumn>` clause used to read a generated id portably. */
  returningId(idColumn?: string): string;

  /** Map a JS boolean to its stored representation (0/1 on both engines). */
  toDbBool(value: boolean): number;

  /** Interpret a stored value (0/1, or native boolean) as a JS boolean. */
  fromDbBool(value: unknown): boolean;
}

function fromDbBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "t" || value === "true";
}

export class SqliteDialect implements Dialect {
  readonly kind = "sqlite" as const;

  now(): string {
    return "datetime('now')";
  }

  jsonExtract(column: string, path: string): string {
    return `json_extract(${column}, '$.${path}')`;
  }

  returningId(idColumn = "id"): string {
    return ` RETURNING ${idColumn}`;
  }

  toDbBool(value: boolean): number {
    return value ? 1 : 0;
  }

  fromDbBool(value: unknown): boolean {
    return fromDbBool(value);
  }
}

export class PostgresDialect implements Dialect {
  readonly kind = "postgres" as const;

  now(): string {
    return "to_char((now() at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS')";
  }

  jsonExtract(column: string, path: string): string {
    const segments = path.split(".");
    if (segments.length === 1) {
      return `(${column}::jsonb ->> '${segments[0]}')`;
    }
    return `(${column}::jsonb #>> '{${segments.join(",")}}')`;
  }

  returningId(idColumn = "id"): string {
    return ` RETURNING ${idColumn}`;
  }

  toDbBool(value: boolean): number {
    return value ? 1 : 0;
  }

  fromDbBool(value: unknown): boolean {
    return fromDbBool(value);
  }
}

export function createDialect(kind: DbDriver): Dialect {
  return kind === "postgres" ? new PostgresDialect() : new SqliteDialect();
}
