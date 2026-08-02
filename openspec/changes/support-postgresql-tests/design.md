## Context

`support-postgresql` replaces the synchronous `bun:sqlite` runtime layer with the async `Bun.SQL` `Db` port and adds a PostgreSQL engine. Two testing realities follow from the investigation:

1. **The backend suite's DB foundation is synchronous and hand-maintained.** `src/bun/test/helpers.ts` `initDb()` returns a sync `bun:sqlite` `Database` and builds the schema from a ~200-line inline DDL copy that already risks drift from the real migrations. Seed helpers use `db.run` / `last_insert_rowid()`. All ~140 backend test files depend on this. Under the async `Db` port, the fixture layer breaks and must migrate.
2. **The PostgreSQL path has no coverage.** Baseline schema, PG dialect SQL, and type coercion can only be *executed* against a real Postgres.

Verified facts that shape the plan: `Bun.SQL` `sqlite://:memory:` shares state across the pool (in-memory integration survives the async move); `$1` placeholders work on both adapters; `e2e/api` already boots a real server against in-memory SQLite (the true end-to-end backend path).

This change is deliberately separate from `support-postgresql` so the feature and its tests review and land independently. It consumes the DI seams that `support-postgresql` provides and adds no production code.

## Goals / Non-Goals

**Goals:**
- Migrate the backend test harness to the async `Db` port with zero schema drift (schema built from real migrations).
- Provide the two injection fixtures the strategy relies on: an in-repo `FakeDb` and a Docker-gated `pgTestContainer()`.
- Cover the four spec areas (config, abstraction, PostgreSQL, migration runner) across the unit / in-memory / testcontainers tiers, extrapolated beyond the base specs.
- Keep the PostgreSQL tier optional locally (skip without Docker) and enforced in CI.

**Non-Goals:**
- Any production code change — gaps are fixed in `support-postgresql`, never via a test-only path.
- New Playwright/UI specs — the frontend is untouched and its suite mocks the backend.
- Data-migration (SQLite→Postgres) tooling coverage — out of scope for both changes.
- Load/performance/soak testing of the pool — functional correctness only.

## Decisions

### 1. Two-layer repository testing: FakeDb + in-memory (decision #48)
Pure-unit tests inject a `FakeDb` (records SQL text + params, returns canned rows) to assert query shape, binding, and mapping in isolation; integration tests inject a real in-memory `Bun.SQL` sqlite `Db` to assert real execution and transaction semantics. DI is the single mechanism for both — no test-only branches.
- **Why:** FakeDb catches wrong columns/params that sqlite might silently tolerate (and would fail on PG); in-memory catches real SQL errors. Together they give shape + execution confidence.

### 2. Schema via real migrations (decision #49)
`initDb()` becomes async and builds the in-memory schema by running the real SQLite migration path instead of the inline DDL copy.
- **Why:** removes drift, exercises the SQLite migration path on every run, and deletes duplicated schema. Cost: 53 migrations per test file on in-memory sqlite (cheap); a broken migration fails many tests at once (a useful signal).
- **Alternative:** keep the inline DDL (perpetuates drift); snapshot a dump (drift by staleness).

### 3. Testcontainers Postgres, Docker-gated (decision #50)
PG-execution tests use a `pgTestContainer()` fixture; they skip with a clear message when Docker is unavailable, and CI runs them. Pure logic (dialect fragments, type-coercion mappers with fake rows) stays no-DB.
- **Why:** only a real Postgres proves the baseline schema and PG dialect SQL; testcontainers give reproducible isolation without blocking Docker-less local dev.
- **Alternative:** unit-only + manual PG (PG execution never auto-verified); shared external CI Postgres (less hermetic).

### 4. No new Playwright; UI suite as regression (decision #51)
No UI specs are added; the existing Playwright suite is relied on to prove the frontend didn't regress. End-to-end DB confidence lives in `e2e/api`.
- **Why:** the Playwright backend is fully mocked, so UI specs would assert nothing about persistence.

### Test pyramid
```
 UNIT [FakeDb / pure]   config resolution · dialect fragments · type mappers · repo SQL-shape
 INTEG [in-memory Db]   Db port rows/exec/begin · repos · migration runner SQLite path · e2e/api
 INTEG [testcontainers] baseline provisioning · PG dialect execution · parity · runner PG path
 UI    [mocked]         no new specs — existing suite green as regression
```

## Risks / Trade-offs

- **~140 test files ripple to async at the seed/DB seams** → the churn is mechanical (add `await`); track it as an explicit harness-migration work item so it is not mistaken for new coverage, and land it before adding new tiers.
- **Testcontainers flakiness / CI cost** → gate locally on Docker availability with a clear skip; pin the Postgres image; keep the PG tier focused on execution/parity, not exhaustive re-runs of logic already unit-tested.
- **FakeDb drifting from real `Db` behavior** → keep `FakeDb` minimal (record + canned rows only); rely on the in-memory tier for real semantics so the fake never encodes behavior.
- **Schema-parity depth (PC-5)** → a full cross-engine schema diff is stronger but heavier; a "known tables/indexes/constraints exist" check is lighter. Leaning lighter unless a full diff is requested (open question).
- **Broken migration fails many tests at once** (from schema-via-migrations) → acceptable; it is an accurate early signal and points directly at the cause.

## Migration Plan

1. Land `support-postgresql` first (provides the `Db` port, `Dialect`, `resolveDbConfig`, dialect-aware runner, injected-logger seam).
2. Migrate `helpers.ts` (`async initDb()` via real migrations; async seeds) and sweep the ~140 files to `await`.
3. Add `FakeDb` and `pgTestContainer()` fixtures.
4. Add unit tier (config, dialect, mappers, provider/DI, repo SQL-shape).
5. Add in-memory tier (Db port, repositories, runner SQLite path).
6. Add testcontainers tier (baseline, PG dialect, parity, runner PG path, type coercion end-to-end) + CI Postgres job.

**Rollback:** the harness migration is coupled to `support-postgresql`; if that reverts, this reverts with it. New test files are additive and can be removed without affecting production.

## Open Questions

- **Schema-parity depth (PC-5):** full introspection diff vs a lighter "expected tables/indexes exist" assertion — decide before implementing that scenario.
- Whether to add an `e2e/api` run against Postgres (real server + testcontainers) in addition to the existing in-memory sqlite run, or defer it — the alternative offered under decision #51.
- Exact testcontainers library/runtime pin and the CI Postgres image version.
