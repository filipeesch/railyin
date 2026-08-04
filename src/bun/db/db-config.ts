import yaml from "js-yaml";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { getGlobalConfigDir } from "../config/index.ts";
import { getDataDir } from "../utils/platform.ts";

// ─── Resolved DB config ───────────────────────────────────────────────────────

export type DbDriver = "sqlite" | "postgres";

export interface SqliteDbConfig {
  driver: "sqlite";
  /** Absolute file path, or ":memory:" for an in-memory database. */
  path: string;
}

export interface PostgresPoolConfig {
  max?: number;
  /** Idle connection timeout in seconds. */
  idleTimeout?: number;
}

export interface PostgresDbConfig {
  driver: "postgres";
  url: string;
  pool?: PostgresPoolConfig;
}

export type DbConfig = SqliteDbConfig | PostgresDbConfig;

// ─── File name ────────────────────────────────────────────────────────────────

export const DATABASE_CONFIG_FILENAME = "database.yaml";

/** Default SQLite file path used when no config file and no RAILYN_DB override exist. */
export function defaultSqlitePath(): string {
  return join(getDataDir(), "railyn.db");
}

// ─── Pure resolver ────────────────────────────────────────────────────────────

type EnvLike = Record<string, string | undefined>;

/** Expand `${VAR}` occurrences in a string using the injected environment. */
function expandEnv(value: string, env: EnvLike): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const replacement = env[name];
    if (replacement === undefined) {
      throw new Error(
        `database.yaml references environment variable \${${name}} which is not set`,
      );
    }
    return replacement;
  });
}

interface RawDatabaseYaml {
  driver?: unknown;
  sqlite?: { path?: unknown } | null;
  postgres?: { url?: unknown; pool?: { max?: unknown; idleTimeout?: unknown } | null } | null;
}

/**
 * Resolve the database configuration from injected inputs — pure and unit-testable
 * (no direct `process.env` / `fs` access).
 *
 * Resolution order:
 *   1. `env.RAILYN_DB` set        → SQLite at that path (":memory:" or a file). Overrides the file.
 *   2. `fileContent` is null/empty → SQLite at the default path.
 *   3. `fileContent` present       → parse `driver` and its nested block.
 *
 * @param env         The environment map (inject `process.env` in production).
 * @param fileContent Raw `config/database.yaml` contents, or null when the file is absent.
 * @param defaultPath The SQLite path used for the default/env cases (inject `defaultSqlitePath()`).
 */
export function resolveDbConfig(
  env: EnvLike,
  fileContent: string | null,
  defaultPath: string,
): DbConfig {
  // 1. Env override wins (tests / dev / CI).
  const envDb = env.RAILYN_DB;
  if (envDb) {
    return { driver: "sqlite", path: envDb };
  }

  // 2. No file → default SQLite.
  if (fileContent === null || fileContent.trim() === "") {
    return { driver: "sqlite", path: defaultPath };
  }

  // 3. Parse the file.
  let parsed: RawDatabaseYaml;
  try {
    parsed = (yaml.load(fileContent) ?? {}) as RawDatabaseYaml;
  } catch (err) {
    throw new Error(
      `Failed to parse database.yaml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const driver = parsed.driver;
  if (driver !== "sqlite" && driver !== "postgres") {
    throw new Error(
      `database.yaml: invalid "driver" value ${JSON.stringify(driver)} — expected "sqlite" or "postgres"`,
    );
  }

  if (driver === "sqlite") {
    const rawPath = parsed.sqlite?.path;
    const path = typeof rawPath === "string" && rawPath.trim() !== "" ? expandEnv(rawPath, env) : defaultPath;
    return { driver: "sqlite", path };
  }

  // driver === "postgres"
  const rawUrl = parsed.postgres?.url;
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error(
      'database.yaml: driver "postgres" requires a non-empty "postgres.url"',
    );
  }
  const url = expandEnv(rawUrl, env);

  const rawPool = parsed.postgres?.pool ?? undefined;
  let pool: PostgresPoolConfig | undefined;
  if (rawPool) {
    pool = {};
    if (typeof rawPool.max === "number") pool.max = rawPool.max;
    if (typeof rawPool.idleTimeout === "number") pool.idleTimeout = rawPool.idleTimeout;
  }

  return pool ? { driver: "postgres", url, pool } : { driver: "postgres", url };
}

// ─── Impure loader (production entry point) ───────────────────────────────────

/** Read `config/database.yaml` (if present) and resolve the effective DB config. */
export function loadDbConfig(): DbConfig {
  const filePath = join(getGlobalConfigDir(), DATABASE_CONFIG_FILENAME);
  const fileContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
  return resolveDbConfig(process.env, fileContent, defaultSqlitePath());
}
