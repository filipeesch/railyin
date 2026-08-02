## Context

Railyin's persistence is a synchronous `bun:sqlite` singleton created in `src/bun/db/index.ts` (`getDb(): Database`). Roughly 200 call sites across `src/bun/db/**`, `src/bun/handlers/**`, and `src/bun/engine/**` use the synchronous typed API (`.query<Row,Params>().get()/.all()`, `.run`, `.exec`, `.prepare`, `.transaction`). Schema is built by 53 file-based migrations (`src/bun/db/migrations/*.ts`) guarded by a checksum-immutability runner. Three streaming hot-path buffers (`raw-message-buffer`, `conv-message-buffer`, `write-buffer`) rely on `db.prepare()` + synchronous `db.transaction(items => …)` batching.

The goal is to support PostgreSQL as an alternative engine, selected via `config/database.yaml`, by moving the **runtime** data layer onto Bun's native promise-based `Bun.SQL` client — which drives both `sqlite://` and `postgres://` through one API. Investigation confirmed on Bun 1.3.13: the `sqlite://` adapter works, `RETURNING` works, `sql.begin(async tx => …)` transactions work, and `$1` positional placeholders work on **both** adapters via `sql.unsafe(text, params)`.

This design records eight decisions already made in explore mode (decision records #40–#47) and the architecture they imply. There is no external API impact: `src/shared/rpc-types.ts` and the frontend are untouched.

## Goals / Non-Goals

**Goals:**
- Declarative DB selection: `config/database.yaml` absent → SQLite default; present → `driver:` selects the engine.
- One promise-based runtime data layer (`Bun.SQL`) serving both SQLite and PostgreSQL.
- A thin, injectable `Db` port and a `Dialect` strategy that isolate engine differences (SRP/DIP, no god class).
- Preserve the 53 SQLite migration files byte-for-byte (checksums intact); add a single consolidated PostgreSQL baseline.
- Keep existing test seams working without a 130-site DI rewrite.

**Non-Goals:**
- Re-dialecting historical SQLite migrations for Postgres.
- Adopting an ORM / query builder (Kysely/Drizzle) — explicitly rejected in favor of the native Bun SQL lib.
- Converting every ad-hoc handler query into a formal repository (noted as follow-up cleanup, not in scope).
- Data migration tooling to move an existing SQLite database into PostgreSQL.
- MySQL/MariaDB support (the driver-tagged config leaves room for it, but it is out of scope).
- New automated test coverage for the swap (per the task, testing is handled separately).

## Decisions

### 1. Full unified async rewrite to `Bun.SQL` (rec #40)
Replace the synchronous `bun:sqlite` runtime layer entirely. Every DB read/write becomes `await`; the async color propagates up through repositories → handlers → orchestrator/engines.
- **Why:** the only way to get true Postgres support without maintaining two parallel data paths; matches the task's explicit "move everything to native Bun promise-based SQL lib."
- **Alternatives:** (a) abstraction seam + incremental migration — staged but longer-lived dual state; (b) keep `bun:sqlite` for SQLite and add `Bun.SQL` only for Postgres — contradicts the goal and still requires the sync→async conversion anyway.

### 2. Thin `Db` port + `Dialect` strategy (rec #43)
A small `Db` interface — `rows<T>(text, params)`, `exec(text, params)`, `begin(fn)` — implemented over `Bun.SQL`, plus a `Dialect` strategy (`SqliteDialect` / `PostgresDialect`) supplying the divergent fragments (`now()`, `jsonExtract()`, RETURNING-based insert-id, boolean mapping). Repositories keep owning their SQL and depend on the port.
- **Why:** isolates the dialect surface (SRP), gives a clean DIP seam, and avoids both a god class and a wholesale repository rewrite.
- **Alternatives:** full repository-per-aggregate (scope creep); expose the raw `Bun.SQL` instance (inline dialect handling, poor testability).

```
getDb(): Db ──▶ BunSqlDb { sql: Bun.SQL, dialect: Dialect }
                   rows(text,$p)  = sql.unsafe(text,$p)
                   exec(text,$p)  = sql.unsafe(text,$p)
                   begin(fn)      = sql.begin(tx => fn(wrap(tx)))
Dialect ── SqliteDialect | PostgresDialect
             now() · jsonExtract(col,key) · returningId(col) · toBool/fromBool
```

### 3. `$1` placeholders + `Db.rows/exec` wrapper (rec #44)
Standardize every query on `$1..$n` positional placeholders routed through the port (which delegates to `sql.unsafe(text, params)`). Migration is mechanical: `?` → `$1..$n`, and `.query().get/all` → `await db.rows()` / `.run/.exec` → `await db.exec()`.
- **Why:** `$1` is verified to work on both adapters, so one query text serves both engines; smallest per-site diff; greppable and reviewable. Params stay bound despite the `unsafe` name — a short comment convention will note this.
- **Alternatives:** rewrite all to tagged templates (largest churn, awkward for dynamic/IN-list SQL); hybrid (two idioms, inconsistent).

### 4. Explicit-executor transactions (rec #45)
Transactions use `db.begin(async tx => …)`. Repository methods that must join a caller's transaction take an optional executor argument defaulting to the injected client.
- **Why:** only ~14 transaction sites; explicit threading is Clean-Code-clear and avoids hidden state.
- **Alternatives:** AsyncLocalStorage ambient tx (implicit, foot-guns); UnitOfWork object (over-engineered at this scale).

### 5. Fresh Postgres baseline + frozen SQLite history (rec #41)
Keep the 53 SQLite files unchanged; author one consolidated Postgres baseline migration equal to the current end-state schema. Future migrations are authored dual-dialect.
- **Why:** no existing Postgres DB needs the incremental history; re-dialecting 53 files is high-effort, low-value, and fights the checksum guard.
- **Alternatives:** dialect-branch every historical file (breaks immutability, error-prone); ORM-generated migrations (rejected).

### 6. Dialect-aware migration runner with dual paths (rec #46)
The runner branches on driver. SQLite: replay the 53 sync files through a short-lived `bun:sqlite` `Database` at migrate-time (file contract + checksum guard untouched). Postgres: apply the async baseline via `Bun.SQL`. Backup is dialect-aware — file copy for SQLite files, no-op (with a log line) for Postgres.
- **Why:** literally preserves "frozen history," keeps the checksum system intact, and cleanly separates migrate-time from run-time. `bun:sqlite` remains only as a migrate-time (and in-memory-test) dependency.
- **Alternatives:** async-convert all 53 files (breaks checksums); squash SQLite into a baseline too (risky for existing user DBs).

### 7. Provider + constructor DI delivery (rec #47)
Keep a module-level `getDb(): Db` provider returning the initialized async port; classes/repositories accept `Db` via constructor defaulting to the provider (`db ?? getDb()`); module-level functions call the provider.
- **Why:** SOLID where it pays off (testable seams for classes) without threading `Db` through ~130 call sites; mirrors the existing `db ?? getDb()` pattern.
- **Alternatives:** pure constructor DI everywhere (large composition-root refactor); global-only (regresses existing test seams).

### 8. Async boot initialization
`src/bun/index.ts` gains `await initDb()` before `runMigrations()`. The `Bun.SQL` client object is created and its connection established (Postgres connect is async) before the provider is used. Boot fails fast on connection error.

### 9. Testability seams (added after the testing exploration)
The following production-code shapes are chosen so the feature can be tested with dependency injection only — no test-only branches or environment special-casing in production paths. These are feature-development decisions; the test suite itself lives in the separate `support-postgresql-tests` change.
- **`resolveDbConfig(env, fileContent)` takes injected inputs.** The resolver receives the environment map and the parsed config-file content as arguments rather than reaching into `process.env` / `fs` directly. Production wires the real env and file reader at the call site; tests pass literals and assert resolution with no temp files. Keeps the resolver pure and the resolution order (env → file → default) verifiable in isolation.
- **`Db` is an interface, not a concrete class.** The port is defined as an interface with a `BunSqlDb` implementation, so a `FakeDb` (recording SQL text + params, returning canned rows) can be injected into repositories for pure unit tests, while a real in-memory `Bun.SQL` client serves integration tests. Combined with the `db ?? getDb()` default (decision #7), no repository needs a test-only construction path.
- **The migration runner accepts an injected logger (and `Db`/`Dialect`).** The dialect-aware backup/log behavior (SQLite file copy vs Postgres no-op-with-log) is observable by injecting a logger, so it can be asserted without inspecting the filesystem or stdout. The runner takes its `Db`/`Dialect` via parameter so a test can drive either path against an injected client.
- **Buffers keep their existing `db` parameter.** `raw-message-buffer` / `conv-message-buffer` / `write-buffer` already accept the DB handle by argument; this seam is preserved (now typed as the `Db` port) so async flush behavior is testable against an in-memory `Db`.

### Config resolution order
```
RAILYN_DB env set?  ── yes ──▶ SQLite at RAILYN_DB (tests/dev; overrides file)
        │ no
config/database.yaml exists? ── no ──▶ SQLite at ~/.railyn/railyn.db (default)
        │ yes
   driver: sqlite  ──▶ SQLite at sqlite.path
   driver: postgres ─▶ PostgreSQL at postgres.url (+ optional pool)
```

### Hot-path buffers
`raw-message-buffer` / `conv-message-buffer` / `write-buffer` move from `prepare` + synchronous `transaction(batch)` to `await db.begin(async tx => …)` with batched multi-row inserts. The existing decouple-from-stream design (buffering writes off the streaming path) MUST be preserved so `await` never stalls token streaming. This is a natural moment to extract one shared batched-insert helper (cleanup opportunity, optional).

## Risks / Trade-offs

- **Async reaches streaming hot paths** → keep the buffer/queue indirection that already decouples DB writes from streaming; verify no `await` is introduced synchronously inline in the token loop.
- **Wide blast radius (~200 sites, async ripple through engines)** → mechanical `$1` + `db.rows/exec` conversion keeps each diff small and greppable; land in reviewable waves (infra → repositories → handlers → engines → buffers) even though it ships as one change.
- **PostgreSQL strict typing vs SQLite loose typing** → centralize normalization in the `Dialect` boolean map and row mappers (bigint→number, native bool→boolean); build the baseline schema with deliberate column types.
- **`sql.unsafe` naming implies injection risk** → params remain bound; add a comment convention and a short note in the DB module so reviewers don't mistake it for string interpolation.
- **Two migration execution paths to maintain** → contained in the runner; the SQLite path is effectively frozen, and future migrations follow a documented dual-dialect authoring convention.
- **Transaction semantics differ (SQLite WAL/busy_timeout vs PG MVCC)** → review the 14 transaction sites for assumptions about serialization; the explicit-executor model makes each site visible.
- **`bun:sqlite` not fully removed** → retained deliberately for SQLite migrate-time replay and in-memory tests; documented as intentional, not an oversight.

## Migration Plan

1. Add `resolveDbConfig()`, `config/database.yaml(.sample)`, and the `Db` port + `Bun.SQL` adapter + `Dialect` strategy.
2. Add async `initDb()` and switch `getDb()` to return the port; wire boot in `index.ts`.
3. Make the migration runner dialect-aware; add the consolidated Postgres baseline; keep SQLite replay via `bun:sqlite`.
4. Convert query sites to `$1` + `db.rows/exec` and propagate async, wave by wave (repositories → handlers → engines → buffers).
5. Thread the 14 transaction sites through `db.begin` + optional executor params.

**Rollback:** the change is additive at the config layer — with no `config/database.yaml` and `RAILYN_DB` unset, behavior defaults to the same SQLite file. Reverting the branch restores the synchronous layer; no on-disk schema change is forced for SQLite users.

## Open Questions

- Exact `pool` keys to surface in `database.yaml.sample` beyond `max` / `idleTimeout` (e.g. `connectionTimeout`) — finalize against the `Bun.SQL` options actually supported on the pinned Bun version.
- Whether the shared batched-insert helper extraction (buffers) ships with this change or as the first follow-up cleanup — defer to implementation review.
