## ADDED Requirements

### Requirement: File-based migration discovery
The runner SHALL discover all migration files by globbing `src/bun/db/migrations/*.ts`, excluding `runner.ts` itself. Files SHALL be sorted alphabetically by filename to determine application order.

#### Scenario: Discovers and sorts migration files
- **WHEN** the migrations directory contains files `001_initial.ts`, `031_foo.ts`, and `20260426120000_bar.ts`
- **THEN** the runner applies them in that exact alphabetical order

#### Scenario: Excludes runner.ts from migrations
- **WHEN** `runner.ts` is present in the migrations directory
- **THEN** it is not treated as a migration and is not imported as one

---

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

---

### Requirement: Startup duplicate-ID validation
The runner SHALL validate that no two migration files export the same `id`. If duplicates are detected, the runner SHALL throw before applying any migration.

#### Scenario: Duplicate IDs cause hard failure
- **WHEN** two migration files export the same `id` value
- **THEN** `runMigrations()` throws an error identifying the duplicate ID and neither file is applied

---

### Requirement: Startup sort-order validation
The runner SHALL validate that the alphabetical sort order of filenames corresponds to a valid migration sequence — specifically, that the sorted filename list matches the sorted ID list. If a file would apply before a migration with a lexicographically smaller ID, the runner SHALL throw.

#### Scenario: Filename order matches ID order
- **WHEN** filenames sort to `001_a.ts`, `002_b.ts`, `20260426_c.ts` and their exported IDs also sort in that order
- **THEN** validation passes

#### Scenario: Mismatched filename and ID order causes failure
- **WHEN** a file named `020_foo.ts` exports `id = '015_foo'` (the ID would sort before its position)
- **THEN** `runMigrations()` throws identifying the offending file

---

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

---

### Requirement: Automatic DB backup before migration
Before applying any pending migrations, the runner SHALL copy the database file to `<dbPath>.backup`. The backup SHALL be skipped when `RAILYN_DB` is `:memory:`.

#### Scenario: Backup created when pending migrations exist
- **WHEN** there are unapplied migrations and the DB is a file
- **THEN** the runner creates `<dbPath>.backup` before applying the first migration

#### Scenario: Backup skipped for in-memory DB
- **WHEN** `RAILYN_DB` is `:memory:`
- **THEN** no backup file is created

#### Scenario: Backup skipped when no pending migrations
- **WHEN** all migrations are already applied
- **THEN** no backup file is created or overwritten

---

### Requirement: Bootstrap checksum column
The runner SHALL add the `checksum TEXT` column to `schema_migrations` if it does not already exist, as part of its bootstrap step (before any migration logic runs).

#### Scenario: checksum column added on first run
- **WHEN** `schema_migrations` exists but has no `checksum` column
- **THEN** the runner adds the column without error and existing rows have `checksum = NULL`

#### Scenario: checksum column presence is idempotent
- **WHEN** `schema_migrations` already has a `checksum` column
- **THEN** the bootstrap step completes without error
