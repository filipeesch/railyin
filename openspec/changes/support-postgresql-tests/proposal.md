## Why

The `support-postgresql` change moves the runtime data layer from synchronous `bun:sqlite` to the async `Bun.SQL` `Db` port and adds a PostgreSQL engine. That swap has two testing consequences: (1) the entire backend suite's DB foundation (`src/bun/test/helpers.ts`) is synchronous and hand-maintains a schema copy that will break at the fixture layer, and (2) the PostgreSQL path (baseline schema, dialect SQL, type coercion) has no automated coverage today. This change delivers the test infrastructure and the scenario coverage that prove the new data layer works on both engines. It depends on `support-postgresql` and is kept separate so the feature and its test suite can be reviewed and land independently.

## What Changes

- Migrate the backend test harness to the async `Db` port: `helpers.initDb()` becomes async and builds the in-memory schema by running the **real** SQLite migrations (removing the drifting inline DDL copy); `seedProjectAndTask` / `seedChatSession` become async. The ~140 existing backend test files ripple to `await` at the seed/DB seams (mechanical).
- Add a shared **`FakeDb`** fixture implementing the `Db` port — records the SQL text + params it receives and returns canned rows — for pure-unit repository/logic tests.
- Add a **`pgTestContainer()`** fixture that starts an ephemeral PostgreSQL (testcontainers) for PG-execution tests and **skips with a clear message when Docker is unavailable**; pure-logic tests never need it.
- Add ~45–50 scenarios across four areas, extrapolated from the `support-postgresql` specs: config resolution, the `Db` port + `Dialect` strategy + transactions/DI, PostgreSQL execution (baseline/pool/type-coercion/parity), and the dialect-aware migration runner.
- **No new Playwright/UI specs.** The frontend is untouched and the Playwright suite mocks the backend entirely; the existing UI suite is relied on as regression only. End-to-end DB confidence lives in `e2e/api` (real server).

## Capabilities

### New Capabilities
- `db-test-harness`: The async in-memory DB fixture (schema via real migrations), the injectable `FakeDb`, and the Docker-gated `pgTestContainer()` helper — the shared infrastructure all data-layer tests build on.
- `postgresql-test-coverage`: The scenario contract proving the async data layer and PostgreSQL path — config resolution, `Db`/`Dialect`/transactions, PostgreSQL execution + parity, and the dual-path migration runner — across the unit / in-memory / testcontainers tiers.

### Modified Capabilities
<!-- None. Existing *-tests specs (decision-repository, conv-message-buffer, write-buffer, etc.) will be updated mechanically for the async harness during implementation, but their spec-level requirements do not change. -->

## Impact

- **New test infra:** `FakeDb` fixture, async `initDb()` (real-migration schema), `pgTestContainer()` helper; a new testcontainers dev dependency and a CI Postgres job.
- **Wide but mechanical churn:** ~140 backend test files await the now-async `helpers.ts` seeds; existing repository/buffer test suites adapt to injected `Db`.
- **New test files:** config-resolution unit tests, `Db`-port + `Dialect` tests, PostgreSQL integration tests, migration-runner dual-path tests.
- **Depends on** `support-postgresql` (the `Db` port, `Dialect`, `resolveDbConfig(env, fileContent)`, dialect-aware runner, and injected-logger seam it introduces).
- **No production code changes** land in this change — it consumes the DI seams added by `support-postgresql`; if a gap is found, it is fixed there, not via a test-only path here.
