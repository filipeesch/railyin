## Purpose
Defines how the migration runner discovers, validates, and applies `src/bun/db/migrations/*.ts` files, including checksum verification and the schema migrations introduced by the db-lock resilience change. Pre-migration backups are owned by `StartupMaintenance` (see `db-startup-maintenance`), not the runner.

## Requirements

### Requirement: File-based migration discovery
The runner SHALL discover all migration files by globbing `src/bun/db/migrations/*.ts`, excluding `runner.ts` itself. Files SHALL be sorted alphabetically by filename to determine application order.

#### Scenario: Discovers and sorts migration files
- **WHEN** the migrations directory contains files `001_initial.ts`, `031_foo.ts`, and `20260426120000_bar.ts`
- **THEN** the runner applies them in that exact alphabetical order

#### Scenario: Excludes runner.ts from migrations
- **WHEN** `runner.ts` is present in the migrations directory
- **THEN** it is not treated as a migration and is not imported as one

### Requirement: Migration file contract
Each migration file SHALL export:
- `id: string` — the identity recorded in `schema_migrations` (e.g. `'001_initial'` or `'20260426120000_add_tags'`)
- `up(db: Database): void` — the function that applies the migration
- `managesTransaction?: boolean` — optional flag; when `true`, the runner SHALL NOT wrap `up()` in `db.transaction()` and the migration is responsible for its own transaction lifecycle and for inserting its own `schema_migrations` row

#### Scenario: Standard migration (no transaction flag)
- **WHEN** a migration file exports `id` and `up` without `managesTransaction`
- **THEN** the runner wraps `up(db)` in `db.transaction()` and inserts the `id` into `schema_migrations` after `up()` completes

#### Scenario: Self-managed transaction migration
- **WHEN** a migration file exports `managesTransaction = true`
- **THEN** the runner calls `up(db)` directly without wrapping in `db.transaction()`, and the migration file itself is responsible for committing and recording in `schema_migrations`

### Requirement: Startup duplicate-ID validation
The runner SHALL validate that no two migration files export the same `id`. If duplicates are detected, the runner SHALL throw before applying any migration.

#### Scenario: Duplicate IDs cause hard failure
- **WHEN** two migration files export the same `id` value
- **THEN** `runMigrations()` throws an error identifying the duplicate ID and neither file is applied

### Requirement: Startup sort-order validation
The runner SHALL validate that the alphabetical sort order of filenames corresponds to a valid migration sequence — specifically, that the sorted filename list matches the sorted ID list. If a file would apply before a migration with a lexicographically smaller ID, the runner SHALL throw.

#### Scenario: Filename order matches ID order
- **WHEN** filenames sort to `001_a.ts`, `002_b.ts`, `20260426_c.ts` and their exported IDs also sort in that order
- **THEN** validation passes

#### Scenario: Mismatched filename and ID order causes failure
- **WHEN** a file named `020_foo.ts` exports `id = '015_foo'` (the ID would sort before its position)
- **THEN** `runMigrations()` throws identifying the offending file

### Requirement: Checksum storage and validation
The `schema_migrations` table SHALL have a `checksum TEXT` column (nullable). When the runner first applies a migration, it SHALL compute `sha1(up.toString())` and store it in `checksum`. On subsequent boots, for rows where `checksum IS NOT NULL`, the runner SHALL recompute the hash and throw if it differs from the stored value.

#### Scenario: Checksum stored on first application
- **WHEN** a migration is applied for the first time
- **THEN** its `sha1(up.toString())` is stored in `schema_migrations.checksum`

#### Scenario: Unmodified migration passes checksum check
- **WHEN** an already-applied migration's file has not changed
- **THEN** `runMigrations()` proceeds without error

#### Scenario: Modified migration causes hard failure
- **WHEN** an already-applied migration's `up` function source differs from the stored checksum
- **THEN** `runMigrations()` throws: `"Migration <id> was modified after being applied"`

#### Scenario: NULL checksum rows are skipped (legacy compatibility)
- **WHEN** a `schema_migrations` row has `checksum IS NULL` (applied before checksums were introduced)
- **THEN** checksum validation is skipped for that row

#### Scenario: NULL checksums are backfilled after pending migrations
- **WHEN** the runner has processed all pending migrations and some already-applied rows still have `checksum IS NULL`
- **THEN** the runner backfills the checksum for each such row that has a corresponding migration file

### Requirement: Bootstrap checksum column
The runner SHALL add the `checksum TEXT` column to `schema_migrations` if it does not already exist, as part of its bootstrap step (before any migration logic runs).

#### Scenario: checksum column added on first run
- **WHEN** `schema_migrations` exists but has no `checksum` column
- **THEN** the runner adds the column without error and existing rows have `checksum = NULL`

#### Scenario: checksum column presence is idempotent
- **WHEN** `schema_migrations` already has a `checksum` column
- **THEN** the bootstrap step completes without error

### Requirement: Migrations drop model_raw_messages and logs, index stream_events
New migrations SHALL:
- `055_drop_model_raw_messages`: `DROP TABLE IF EXISTS model_raw_messages` (indexes dropped with the table).
- `056_drop_logs_table`: `DROP TABLE IF EXISTS logs`.
- `057_stream_events_created_at_index`: `CREATE INDEX IF NOT EXISTS idx_stream_events_created_at ON stream_events(created_at)`.

Each SHALL follow the standard migration contract (exported `id` + `up(db)`), be wrapped by the runner in a transaction, and record its own `schema_migrations` row.

#### Scenario: Fresh DB applies drops in order
- **WHEN** a fresh database runs all migrations
- **THEN** `021_model_raw_messages` creates the table, `027_nullable_executions` may rebuild it, and `055` drops it; `003_logs` creates the logs table and `056` drops it; `057` creates the stream_events index — with no dangling references

#### Scenario: Existing DB with the tables applies cleanly
- **WHEN** an existing database with `model_raw_messages` and `logs` runs the new migrations
- **THEN** both tables are dropped and the stream_events index is created without error
