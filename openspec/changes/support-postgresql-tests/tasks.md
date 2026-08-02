## 1. Harness migration (do first)

- [ ] 1.1 Make `helpers.initDb()` async and build the in-memory schema by running the real SQLite migrations; remove the inline DDL copy
- [ ] 1.2 Make `seedProjectAndTask` / `seedChatSession` async and route inserts through the `Db` port, preserving return shapes
- [ ] 1.3 Sweep the ~140 backend test files to `await` the now-async `initDb`/seed helpers and adapt repository/buffer suites to the injected `Db`
- [ ] 1.4 Confirm in-memory state is shared across the pool in the fixture (no divergent `:memory:` connections)

## 2. Shared fixtures

- [ ] 2.1 Add a `FakeDb` implementing the `Db` port: records SQL text + params per call, returns caller-primed canned rows, distinguishes `rows` vs `exec`
- [ ] 2.2 Add a `pgTestContainer()` fixture that starts an ephemeral Postgres, yields a connected `Db`, and tears it down; skip dependent tests with a clear message when Docker is unavailable
- [ ] 2.3 Add the testcontainers dev dependency and a CI Postgres job that runs the `[pg]` tier

## 3. Unit tier (FakeDb / pure — no DB)

- [ ] 3.1 `resolveDbConfig(env, fileContent)` — cover all branches and errors (PC-1: absent→sqlite, postgres url, sqlite path, unknown driver, missing block, RAILYN_DB precedence, malformed YAML, partial pool, sample-file assertion)
- [ ] 3.2 `Dialect` fragments (PC-3): now / jsonExtract (incl. nested) / returningId / boolean round-trip for both dialects
- [ ] 3.3 Type-coercion mappers (PC-6 pure): bigint→number, native bool, null/timestamp/JSON shapes via fake rows
- [ ] 3.4 Repository SQL-shape/mapping via `FakeDb` (PC-2/PC-4): asserts exact SQL text + bound params + provider/DI defaults

## 4. In-memory integration tier (real Bun.SQL sqlite Db)

- [ ] 4.1 `Db` port (PC-2): rows typed/empty-array, `$1` binding not interpolated, `begin` commit, `begin` rollback-on-throw, concurrent transactions isolated
- [ ] 4.2 Provider/DI (PC-4): class defaults to `getDb()`; FakeDb-injected path touches no real DB; optional executor defaults to injected Db
- [ ] 4.3 Migration runner SQLite path (PC-7): frozen-file replay + checksum validation, checksum-mismatch hard failure, `:memory:` backup skip, file backup created for file DB
- [ ] 4.4 Boolean/JSON round-trip on sqlite (PC-6) to pair with the PG assertions

## 5. Testcontainers Postgres tier (Docker-gated)

- [ ] 5.1 Baseline provisioning (PC-5): fresh Postgres → full schema created and baseline recorded
- [ ] 5.2 Schema parity (PC-5): expected tables/indexes/constraints exist on both engines (depth per the open question)
- [ ] 5.3 Pool settings (PC-5): configured `max`/`idleTimeout` applied; defaults when omitted
- [ ] 5.4 Core-flow parity (PC-5): task→conversation→execution→decision→note identical to sqlite; upsert parity
- [ ] 5.5 Type coercion end-to-end (PC-6): bigint id and native boolean normalized against real Postgres
- [ ] 5.6 Migration runner Postgres path (PC-7): async baseline awaited+recorded, failed migration not recorded (boot aborts), idempotent re-run, dialect-aware backup no-op-with-log (injected logger)

## 6. Regression & verification

- [ ] 6.1 Confirm no new Playwright/UI specs added and the existing UI suite stays green (PC-8)
- [ ] 6.2 Run the full backend suite (`bun test src/bun/test`) and `e2e/api` on in-memory sqlite; run the `[pg]` tier with Docker present
- [ ] 6.3 Confirm the `[pg]` tier skips cleanly (clear message, suite still green) when Docker is absent
