## ADDED Requirements

### Requirement: Dialect-aware execution paths
The migration runner SHALL choose an execution path based on the active database driver. For SQLite it SHALL replay the existing file-based migrations (`src/bun/db/migrations/*.ts`) through a short-lived `bun:sqlite` `Database` at migrate-time, preserving the synchronous file contract and checksum guard. For PostgreSQL it SHALL apply the consolidated Postgres baseline (and any future Postgres migrations) through the async `Bun.SQL` client. Runtime application code SHALL use the async `Db` port regardless of which path ran.

#### Scenario: SQLite path replays frozen files
- **WHEN** the active driver is SQLite
- **THEN** the 53 existing migration files run via `bun:sqlite` and their stored checksums are validated as before

#### Scenario: Postgres path runs the baseline
- **WHEN** the active driver is PostgreSQL and `schema_migrations` shows the baseline is unapplied
- **THEN** the runner applies the consolidated Postgres baseline via `Bun.SQL` and records it in `schema_migrations`

#### Scenario: Runtime uses async port after either path
- **WHEN** migrations complete on either engine
- **THEN** all subsequent application queries go through the async `Db` port, not the migrate-time `bun:sqlite` handle

## MODIFIED Requirements

### Requirement: Migration file contract
Each SQLite migration file SHALL continue to export:
- `id: string` — the identity recorded in `schema_migrations` (e.g. `'001_initial'` or `'20260426120000_add_tags'`)
- `up(db: Database): void` — the synchronous function that applies the migration on the `bun:sqlite` migrate-time handle
- `managesTransaction?: boolean` — optional flag; when `true`, the runner SHALL NOT wrap `up()` in `db.transaction()` and the migration is responsible for its own transaction lifecycle and for inserting its own `schema_migrations` row

PostgreSQL migrations (the consolidated baseline and any future ones authored for Postgres) SHALL export `id: string` and an async `up(db: Db): Promise<void>` that applies the migration through the async `Db` port. The runner SHALL await async `up()` and record the `id` in `schema_migrations` on success.

#### Scenario: Standard SQLite migration (no transaction flag)
- **WHEN** a SQLite migration file exports `id` and a synchronous `up` without `managesTransaction`
- **THEN** the runner wraps `up(db)` in `db.transaction()` and inserts the `id` into `schema_migrations` after `up()` completes

#### Scenario: Self-managed transaction migration
- **WHEN** a SQLite migration file exports `managesTransaction = true`
- **THEN** the runner calls `up(db)` directly without wrapping in `db.transaction()`, and the migration file itself is responsible for committing and recording in `schema_migrations`

#### Scenario: PostgreSQL migration is async
- **WHEN** a Postgres migration exports an async `up(db: Db): Promise<void>`
- **THEN** the runner awaits `up()`, and records the `id` in `schema_migrations` after it resolves

### Requirement: Automatic DB backup before migration
Before applying pending migrations, the runner SHALL perform a dialect-appropriate backup. For SQLite file databases it SHALL copy the database file to `<dbPath>.backup`; this SHALL be skipped when the database is in-memory (`:memory:`). For PostgreSQL the runner SHALL NOT attempt a file copy — external backup (e.g. `pg_dump`) is the operator's responsibility — and SHALL log that file-based backup does not apply.

#### Scenario: Backup created when pending SQLite migrations exist
- **WHEN** there are unapplied migrations and the DB is a SQLite file
- **THEN** the runner creates `<dbPath>.backup` before applying the first migration

#### Scenario: Backup skipped for in-memory DB
- **WHEN** the database is `:memory:`
- **THEN** no backup file is created

#### Scenario: File backup skipped for PostgreSQL
- **WHEN** the active driver is PostgreSQL and pending migrations exist
- **THEN** the runner does not attempt a file copy and proceeds to apply migrations (logging that file backup is not applicable)
