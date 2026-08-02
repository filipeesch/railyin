## ADDED Requirements

### Requirement: Async Db port
The runtime data layer SHALL expose a single injectable `Db` port that abstracts the underlying `Bun.SQL` client. The port SHALL provide at minimum: `rows<T>(text, params): Promise<T[]>` for reads, `exec(text, params): Promise<ExecResult>` for writes, and `begin(fn): Promise<T>` for transactions. All operations SHALL be promise-based; no synchronous query API SHALL remain in runtime code.

#### Scenario: Reads return typed rows
- **WHEN** a caller invokes `db.rows<UserRow>("SELECT * FROM users WHERE id = $1", [id])`
- **THEN** it resolves to an array of `UserRow` (empty array when no match)

#### Scenario: Writes report affected rows / returning
- **WHEN** a caller invokes `db.exec("UPDATE t SET x = $1 WHERE id = $2", [x, id])`
- **THEN** the promise resolves after the write completes and exposes affected-row / RETURNING data as applicable

#### Scenario: No synchronous DB calls remain
- **WHEN** the runtime code paths (repositories, handlers, engines, buffers) are inspected
- **THEN** none call the synchronous `bun:sqlite` API (`.query().get/all`, `.run`, `.exec`, `.prepare`, `.transaction`) — all DB access goes through the async `Db` port

### Requirement: Standardized positional placeholders
All runtime queries SHALL use `$1`-style positional placeholders bound through the `Db` port. Parameters SHALL be passed as a values array and never interpolated into the SQL text.

#### Scenario: Placeholders bound, not interpolated
- **WHEN** a query with user-supplied values is executed
- **THEN** the values are passed as bound parameters (`$1`, `$2`, …) and the SQL text contains no string-concatenated values

#### Scenario: Same query text works on both engines
- **WHEN** a `$1`-parameterized query runs against SQLite and against PostgreSQL
- **THEN** both engines execute it correctly with identical placeholder syntax

### Requirement: Dialect strategy for divergent SQL fragments
The layer SHALL provide a `Dialect` strategy with SQLite and PostgreSQL implementations that supply the fragments which differ between engines — at minimum the current-timestamp expression, JSON field extraction, insert-returning-id behavior, and boolean value mapping. Runtime code SHALL obtain these fragments from the active `Dialect` rather than hard-coding SQLite-specific SQL.

#### Scenario: Current timestamp is dialect-provided
- **WHEN** a repository needs "now" in an UPDATE
- **THEN** it uses `Dialect.now()`, which yields the SQLite expression on SQLite and the Postgres expression on PostgreSQL

#### Scenario: JSON extraction is dialect-provided
- **WHEN** a query extracts a field from a JSON column
- **THEN** it uses `Dialect.jsonExtract(...)`, which emits SQLite `json_extract` semantics or Postgres `->>`/jsonb semantics as appropriate

#### Scenario: Insert id retrieval is portable
- **WHEN** a repository inserts a row and needs the generated id
- **THEN** it uses the dialect's RETURNING-based mechanism instead of `last_insert_rowid()`

### Requirement: Explicit-executor transactions
Transactional work SHALL be expressed via `db.begin(async (tx) => { ... })`. Repository methods that must participate in a caller's transaction SHALL accept an optional executor argument (the `Db`/`tx` handle) defaulting to the injected client, so callers can compose multiple repository operations atomically.

#### Scenario: Multiple repository calls in one transaction
- **WHEN** a caller runs `await db.begin(async (tx) => { await repoA.write(x, tx); await repoB.write(y, tx); })`
- **THEN** both writes commit together, or both roll back if either throws

#### Scenario: Default executor when none passed
- **WHEN** a repository method that accepts an optional executor is called without one
- **THEN** it uses the injected `Db` client and runs outside any explicit transaction

### Requirement: Provider plus constructor DI delivery
A module-level provider `getDb(): Db` SHALL return the initialized async port. Classes and repositories SHALL accept a `Db` via constructor, defaulting to the provider (`db ?? getDb()`), so production uses the singleton while tests inject a fake without a global rewrite.

#### Scenario: Class defaults to provider in production
- **WHEN** a repository is constructed without an explicit `Db`
- **THEN** it uses the singleton returned by `getDb()`

#### Scenario: Tests inject a fake Db
- **WHEN** a test constructs a repository with a fake `Db`
- **THEN** all of that repository's queries go through the fake and no real database is touched

### Requirement: Asynchronous database initialization at boot
The application SHALL initialize the database connection asynchronously at startup (before running migrations) and expose it through `getDb()` thereafter. Boot SHALL fail fast with a clear error if the connection cannot be established.

#### Scenario: Connection established before migrations
- **WHEN** the app boots
- **THEN** `initDb()` completes and the `Db` port is available before `runMigrations()` is invoked

#### Scenario: Unreachable Postgres fails fast
- **WHEN** `driver: postgres` is configured but the server is unreachable
- **THEN** boot aborts with an error naming the connection failure rather than starting in a half-initialized state
