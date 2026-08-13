## REMOVED Requirements

### Requirement: backupDb() is size-aware
The migration runner's `backupDb()` SHALL skip the automatic `copyFileSync` backup when the database file exceeds a size threshold (default 1 GB), logging a warning with operator guidance (e.g. use `VACUUM INTO` for a manual consistent backup). Small databases SHALL keep the existing copy behavior, and the backup SHALL always be skipped when `RAILYN_DB` is `:memory:`.

#### Scenario: Large DB skips the automatic copy
- **WHEN** a pending migration exists and the DB file is larger than 1 GB
- **THEN** `backupDb()` logs a warning that the automatic backup was skipped and does not copy the file

#### Scenario: Small DB keeps the automatic copy
- **WHEN** a pending migration exists and the DB file is at or below the threshold
- **THEN** `backupDb()` copies the file to `<db>.backup` and logs `[db] Backup created:` as today

#### Scenario: Backup skipped for in-memory DB
- **WHEN** `RAILYN_DB` is `:memory:`
- **THEN** no backup file is created

#### Scenario: Backup skipped when no pending migrations
- **WHEN** all migrations are already applied
- **THEN** no backup file is created or overwritten
