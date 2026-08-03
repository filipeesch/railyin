## 1. Configuration & resolution

- [x] 1.1 Add `DbConfig` types and `resolveDbConfig(env, fileContent)` implementing the resolution order (RAILYN_DB env → `config/database.yaml` `driver` block → SQLite default at `~/.railyn/railyn.db`); take env + parsed config as injected inputs (no direct `process.env`/`fs` reads) so it is unit-testable without temp files
- [x] 1.2 Validate config: reject unknown `driver` values and missing nested block/URL for the selected driver, with descriptive startup errors
- [x] 1.3 Add `config/database.yaml.sample` documenting `driver: sqlite` and `driver: postgres` (url + pool) and the absent-file→sqlite convention

## 2. Db port, Bun.SQL adapter & Dialect strategy

- [x] 2.1 Define the async `Db` port interface (`rows<T>(text, params)`, `exec(text, params)`, `begin(fn)`, close)
- [x] 2.2 Implement `BunSqlDb` over `Bun.SQL` using `sql.unsafe(text, params)` for `$1` positional binding; add the comment convention noting params stay bound
- [x] 2.3 Define the `Dialect` interface and `SqliteDialect` / `PostgresDialect` (now(), jsonExtract(), returning-id, boolean map)
- [x] 2.4 Wire the active `Dialect` into `BunSqlDb` based on resolved driver

## 3. Boot & provider

- [x] 3.1 Add async `initDb()` that builds the `Bun.SQL` client, establishes the connection (fail fast on error), and stores the singleton
- [x] 3.2 Change `getDb()` to return the `Db` port; update `_resetForTests` / `_softResetForTests` for the async client lifecycle
- [x] 3.3 Call `await initDb()` before `runMigrations()` in `src/bun/index.ts`

## 4. Dialect-aware migration runner

- [x] 4.1 Branch the runner on driver: SQLite path replays the 53 files via a short-lived `bun:sqlite` `Database`, preserving the sync `up(db: Database)` contract and checksum guard
- [x] 4.2 Add the Postgres path: async `up(db: Db): Promise<void>` contract, awaited and recorded in `schema_migrations`
- [x] 4.3 Make backup dialect-aware (file copy for SQLite files, skip `:memory:`, no-op + log for Postgres); route the log line through an injected logger and accept `Db`/`Dialect` by parameter so both paths are drivable/assertable in tests
- [x] 4.4 Author the consolidated PostgreSQL baseline migration matching the current end-state schema (all tables, columns, indexes, constraints)

## 5. Convert the data layer to async ($1 + Db port)

- [x] 5.1 Convert `src/bun/db/repositories/**` (decision, note, model-settings, conversation-injection-state, shell-approval, TaskGitContext) to `$1` + `await db.rows/exec`, taking `Db` via constructor defaulting to the provider
- [x] 5.2 Convert `src/bun/db/*.ts` (todos, seed, task-queries, board-queries, task-repository, workspace-repository, stream-events, mappers usage) to async
- [x] 5.3 Convert `src/bun/handlers/**` DB calls to async and propagate `await`/`async` up through their callers
- [x] 5.4 Convert `src/bun/engine/**` DB access (claude, pi, cursor, copilot, opencode engines, common-tools, compaction-coordinator, dialect-resolver, session-memory) to async
- [x] 5.5 Convert remaining direct `getDb()` users (`project-store`, `logger`, `column-config`) to the async port

## 6. Transactions

- [x] 6.1 Convert the 14 `db.transaction(...)` sites to `await db.begin(async tx => …)`
- [x] 6.2 Add optional executor params to repository methods that must join a caller transaction (default to injected `Db`)

## 7. Hot-path buffers

- [x] 7.1 Rework `raw-message-buffer` and `conv-message-buffer` from `prepare` + sync `transaction(batch)` to `await db.begin` batched multi-row inserts, preserving the off-stream decoupling
- [x] 7.2 Update `write-buffer` to the async flush model and verify no `await` is introduced inline in the token-streaming loop

## 8. Dialect fragment sweep

- [x] 8.1 Replace `datetime('now')` occurrences in live queries with `Dialect.now()`
- [x] 8.2 Replace `json_extract` occurrences with `Dialect.jsonExtract()`
- [x] 8.3 Replace `lastInsertRowid` / `last_insert_rowid()` usage with the dialect RETURNING-based insert-id path
- [ ] 8.4 Normalize boolean/bigint returns in row mappers so SQLite and PostgreSQL yield identical TypeScript shapes

## 9. Verification

- [x] 9.1 Boot with no `config/database.yaml` and confirm SQLite default path is unchanged (existing data intact)
- [ ] 9.2 Boot with `driver: postgres` against a local PostgreSQL, confirm baseline provisions the schema and core flows (tasks, conversations, executions, decisions, notes) work end-to-end
- [x] 9.3 Confirm the 53 SQLite migration files are byte-identical (checksums valid) and `RAILYN_DB=:memory:` tests still run
