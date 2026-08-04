## ADDED Requirements

### Requirement: PostgreSQL engine via Bun.SQL
The application SHALL support PostgreSQL as a runtime database engine driven by Bun's native `Bun.SQL` client using the connection URL from `config/database.yaml`. When `driver: postgres` is configured, all runtime persistence SHALL operate against PostgreSQL through the shared `Db` port.

#### Scenario: Postgres selected and operational
- **WHEN** `driver: postgres` is configured with a valid `url` and the server boots
- **THEN** the application creates, reads, updates, and deletes application data against PostgreSQL

#### Scenario: Full feature parity with SQLite path
- **WHEN** the same application flows (tasks, conversations, executions, decisions, notes) run on PostgreSQL
- **THEN** they behave identically to the SQLite path from the caller's perspective

### Requirement: Consolidated PostgreSQL baseline schema
The PostgreSQL migration path SHALL provide a single consolidated baseline migration that recreates the current end-state schema (all tables, columns, indexes, and constraints equivalent to the SQLite schema produced by the 53 SQLite migrations) in PostgreSQL dialect. The 53 SQLite migration files SHALL NOT be re-dialected for PostgreSQL.

#### Scenario: Fresh Postgres database is provisioned
- **WHEN** the app boots against an empty PostgreSQL database with `driver: postgres`
- **THEN** the consolidated baseline migration creates the complete schema and records itself in `schema_migrations`

#### Scenario: SQLite migration files remain frozen
- **WHEN** the change is applied
- **THEN** the 53 existing `src/bun/db/migrations/*.ts` files are byte-identical to before and their checksums remain valid on the SQLite path

### Requirement: Connection pool configuration
The `postgres` config block SHALL accept an optional `pool` section (at minimum `max` and `idleTimeout`) that is passed to `Bun.SQL`. When omitted, `Bun.SQL` defaults SHALL apply.

#### Scenario: Pool settings applied
- **WHEN** `postgres.pool.max` and `postgres.pool.idleTimeout` are configured
- **THEN** the `Bun.SQL` client is created with those pool limits

#### Scenario: Pool section omitted
- **WHEN** no `pool` section is provided
- **THEN** the client is created with `Bun.SQL` default pool behavior and boots successfully

### Requirement: PostgreSQL type coercion in mappers
Row mappers SHALL tolerate PostgreSQL's stricter return types. Values that are integers/text on SQLite but arrive as `bigint`, `boolean`, or native types on PostgreSQL SHALL be normalized to the same TypeScript shapes the application already expects (e.g. numeric ids as `number`, 0/1 flags and native booleans mapped to `boolean`).

#### Scenario: Boolean flag round-trips on both engines
- **WHEN** a boolean-like column (e.g. `is_deleted`) is read on SQLite (integer 0/1) and on PostgreSQL (native boolean)
- **THEN** the mapper yields the same TypeScript `boolean` in both cases

#### Scenario: Numeric id normalized
- **WHEN** an id column returns a `bigint` on PostgreSQL
- **THEN** the mapper normalizes it to a `number` matching the SQLite path
