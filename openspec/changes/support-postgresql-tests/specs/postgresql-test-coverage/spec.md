## ADDED Requirements

### Requirement: PC-1 Config resolution coverage
The suite SHALL cover `resolveDbConfig(env, fileContent)` across every resolution branch and error case using injected inputs (no temp files, no `process.env`/`fs` access).

#### Scenario: Absent config defaults to SQLite
- **WHEN** no config content and no `RAILYN_DB` are provided
- **THEN** resolution yields SQLite at the default path

#### Scenario: Postgres driver resolves to its URL
- **WHEN** config content sets `driver: postgres` with a `postgres.url`
- **THEN** resolution yields a Postgres config with that URL

#### Scenario: SQLite driver with explicit path
- **WHEN** config content sets `driver: sqlite` with `sqlite.path`
- **THEN** resolution yields SQLite at that path

#### Scenario: Unknown driver rejected
- **WHEN** config content sets an unsupported `driver`
- **THEN** resolution throws an error naming the invalid value

#### Scenario: Missing connection block rejected
- **WHEN** `driver: postgres` is set with no `postgres` block or no `url`
- **THEN** resolution throws an error naming the missing detail

#### Scenario: RAILYN_DB overrides a present config
- **WHEN** `RAILYN_DB=:memory:` is provided alongside `driver: postgres`
- **THEN** resolution yields in-memory SQLite (env precedence)

#### Scenario: Malformed YAML surfaces a descriptive error
- **WHEN** the config content is not valid YAML
- **THEN** resolution throws a descriptive parse error rather than crashing

#### Scenario: Partial pool block is tolerated
- **WHEN** a `postgres.pool` provides only `max`
- **THEN** resolution succeeds and leaves the other pool settings at Bun.SQL defaults

#### Scenario: Sample file documents both drivers
- **WHEN** `config/database.yaml.sample` is read
- **THEN** it contains commented `driver: sqlite` and `driver: postgres` blocks and the absent→sqlite convention

### Requirement: PC-2 Db port coverage (in-memory)
The suite SHALL cover the `Db` port against a real in-memory SQLite `Db` for reads, writes, parameter binding, and transactions.

#### Scenario: rows returns typed array and empty on no match
- **WHEN** `rows<T>()` runs against matching and non-matching data
- **THEN** it returns a typed array of matches and an empty array (not null) when none match

#### Scenario: Parameters are bound, not interpolated
- **WHEN** a value containing SQL metacharacters is passed as a `$1` parameter
- **THEN** it is stored/compared as a literal and does not alter the query

#### Scenario: begin commits on success
- **WHEN** two writes run inside one `begin(tx)` that returns normally
- **THEN** both are persisted

#### Scenario: begin rolls back on throw
- **WHEN** a `begin(tx)` callback throws after a write
- **THEN** neither write is persisted

#### Scenario: Concurrent transactions do not cross-contaminate
- **WHEN** multiple `begin` blocks run concurrently
- **THEN** each sees only its own uncommitted writes

### Requirement: PC-3 Dialect strategy coverage (pure)
The suite SHALL cover both `Dialect` implementations as pure logic with no database.

#### Scenario: now() differs per dialect
- **WHEN** `now()` is requested from the SQLite and Postgres dialects
- **THEN** each returns its engine-appropriate current-timestamp expression

#### Scenario: jsonExtract differs per dialect
- **WHEN** `jsonExtract(col, key)` is requested from each dialect
- **THEN** SQLite yields `json_extract` semantics and Postgres yields `->>`/jsonb semantics, including nested paths

#### Scenario: returningId differs per dialect
- **WHEN** the insert-id mechanism is requested from each dialect
- **THEN** each returns its RETURNING-based fragment (no `last_insert_rowid()`)

#### Scenario: boolean mapping round-trips both directions
- **WHEN** a boolean is mapped to storage and back for each dialect
- **THEN** `true` and `false` round-trip to the same TypeScript boolean

### Requirement: PC-4 Provider and DI coverage
The suite SHALL cover the provider/constructor-DI delivery of the `Db` port.

#### Scenario: Class defaults to the provider
- **WHEN** a repository is constructed without an explicit `Db`
- **THEN** it uses the `getDb()` singleton

#### Scenario: Class uses an injected FakeDb
- **WHEN** a repository is constructed with a `FakeDb`
- **THEN** all its queries go through the fake and no real database is touched

#### Scenario: Optional executor defaults to injected Db
- **WHEN** a transactional method is called without an executor
- **THEN** it runs on the injected `Db` outside any explicit transaction

### Requirement: PC-5 PostgreSQL execution coverage (testcontainers)
The suite SHALL prove the PostgreSQL path against a real Postgres via the Docker-gated fixture, skipping when unavailable.

#### Scenario: Baseline provisions the schema
- **WHEN** the runner applies the consolidated baseline to a fresh Postgres
- **THEN** the complete schema is created and the baseline is recorded in `schema_migrations`

#### Scenario: Schema parity with SQLite
- **WHEN** the Postgres baseline and the SQLite migrations are each applied
- **THEN** the expected set of tables, indexes, and constraints exists on both engines

#### Scenario: Pool settings applied
- **WHEN** a `pool` with `max`/`idleTimeout` is configured
- **THEN** the Postgres client is created with those limits, and boots on defaults when omitted

#### Scenario: Core flows behave identically
- **WHEN** the task→conversation→execution→decision→note flow runs on Postgres
- **THEN** it produces the same observable results as on SQLite

#### Scenario: Upsert parity
- **WHEN** an `ON CONFLICT … excluded.` upsert runs on each engine
- **THEN** both insert-then-update to the same final state

### Requirement: PC-6 Type coercion coverage
The suite SHALL cover row-mapper normalization of PostgreSQL's stricter return types, using injected fake rows for the pure cases and real Postgres for end-to-end confirmation.

#### Scenario: bigint id normalized to number
- **WHEN** a mapper receives an id as a `bigint`
- **THEN** it yields a `number` matching the SQLite path

#### Scenario: native boolean normalized
- **WHEN** a boolean-like column arrives as an integer `0/1` (SQLite) and as a native boolean (Postgres)
- **THEN** the mapper yields the same TypeScript boolean in both cases

#### Scenario: null / timestamp / JSON shapes match
- **WHEN** nullable, timestamp, and JSON columns are read on both engines
- **THEN** the mapped TypeScript shapes are identical

### Requirement: PC-7 Migration runner coverage
The suite SHALL cover both branches of the dialect-aware runner.

#### Scenario: SQLite path replays frozen files with checksum validation
- **WHEN** the runner runs on SQLite
- **THEN** the existing migration files apply via `bun:sqlite` and stored checksums are validated

#### Scenario: Checksum mismatch fails hard
- **WHEN** an already-applied SQLite migration's source no longer matches its stored checksum
- **THEN** the runner throws and applies nothing further

#### Scenario: Postgres path applies the async baseline
- **WHEN** the runner runs on a fresh Postgres
- **THEN** it awaits the async baseline `up(db)` and records it

#### Scenario: Failed Postgres migration is not recorded
- **WHEN** a Postgres migration throws mid-apply
- **THEN** it is not recorded and boot aborts without a half-applied row

#### Scenario: Re-run is idempotent
- **WHEN** the runner runs again against an already-migrated database on either engine
- **THEN** no migration is re-applied

#### Scenario: Backup is dialect-aware
- **WHEN** the runner has pending migrations on a SQLite file, on `:memory:`, and on Postgres respectively
- **THEN** it copies `<dbPath>.backup` for the file, skips for `:memory:`, and performs no file copy for Postgres (logging that file backup is not applicable, observed via an injected logger)

### Requirement: PC-8 No new UI/Playwright coverage
This change SHALL NOT add Playwright/UI specs for the persistence swap; the existing UI suite SHALL remain green as regression, and end-to-end DB confidence SHALL be located in `e2e/api`.

#### Scenario: Existing UI suite unchanged and green
- **WHEN** the Playwright suite runs after this change
- **THEN** it passes without new DB-specific specs (the mocked backend cannot assert persistence)
