## ADDED Requirements

### Requirement: backupDb() is size-aware
The migration runner's `backupDb()` SHALL skip the automatic `copyFileSync` backup when the database file exceeds a size threshold (default 1 GB), logging a warning with operator guidance (e.g. use `VACUUM INTO` for a manual consistent backup). Small databases SHALL keep the existing copy behavior.

#### Scenario: Large DB skips the automatic copy
- **WHEN** a pending migration exists and the DB file is larger than 1 GB
- **THEN** `backupDb()` logs a warning that the automatic backup was skipped and does not copy the file

#### Scenario: Small DB keeps the automatic copy
- **WHEN** a pending migration exists and the DB file is at or below the threshold
- **THEN** `backupDb()` copies the file to `<db>.backup` and logs `[db] Backup created:` as today

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
