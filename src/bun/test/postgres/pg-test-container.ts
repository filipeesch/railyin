/**
 * Docker-gated PostgreSQL testcontainer fixture (TH-4). Starts an ephemeral
 * Postgres via `@testcontainers/postgresql` and yields a `Db` (backed by
 * `NodePgDb`) connected to it. Callers SHOULD gate test registration on
 * `isDockerAvailable()` (checked synchronously, at module/describe scope —
 * before any `test`/`it` calls) so unavailable Docker produces a clean skip
 * rather than a hung suite.
 */
import { execSync } from "node:child_process";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { NodePgDb } from "./node-pg-db.ts";
import type { Db } from "../../db/db.ts";

let _dockerAvailable: boolean | null = null;

/** Synchronous, fast Docker-daemon reachability check — safe to call at describe-time. */
export function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5_000 });
    _dockerAvailable = true;
  } catch {
    console.warn(
      "[pgTestContainer] Docker is not reachable — skipping the PostgreSQL testcontainers test tier. " +
        "Install/start Docker and re-run `bun run test:postgres` to exercise this tier.",
    );
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

export interface PgFixture {
  db: Db;
  container: StartedPostgreSqlContainer;
  cleanup: () => Promise<void>;
}

/** Start an ephemeral Postgres container and connect a `Db` to it. Only call when `isDockerAvailable()` is true. */
export async function pgTestContainer(): Promise<PgFixture> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const sql = postgres(container.getConnectionUri(), { max: 5 });
  const db = new NodePgDb(sql);
  return {
    db,
    container,
    cleanup: async () => {
      await db.close();
      await container.stop();
    },
  };
}
