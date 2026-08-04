import { defineConfig } from "vitest/config";
import { resolve } from "path";

// PostgreSQL testcontainers tier — runs under vitest/Node because
// `@testcontainers/postgresql`'s container lifecycle hangs indefinitely under
// the Bun runtime (confirmed: identical script resolves in ~1.2s under Node,
// never resolves under Bun). Tests use `NodePgDb` (postgres.js-backed) instead
// of production's `PostgresDb` (Bun.SQL-backed) to exercise the same `Db`
// interface and real production logic (migration runner, Dialect fragments,
// baseline schema) against a real Postgres testcontainer.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@bun": resolve(__dirname, "src/bun"),
      // Neither Bun built-in is ever actually invoked by these tests (they
      // only import modules that reference the types at the top level —
      // see shim comments for details), so throwing/wrapper stubs suffice.
      "bun:sqlite": resolve(__dirname, "src/bun/test/shims/bun-sqlite.ts"),
      "bun": resolve(__dirname, "src/bun/test/shims/bun-sql.ts"),
    },
  },
  test: {
    // .pgtest.ts (not .test.ts) so `bun test` never picks these up —
    // @testcontainers/postgresql hangs indefinitely under Bun (see the
    // comment at the top of this file); only vitest/Node can run this tier.
    include: ["src/bun/test/postgres/**/*.pgtest.ts"],
    pool: "forks",
    environment: "node",
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
