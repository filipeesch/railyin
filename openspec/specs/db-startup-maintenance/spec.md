## Purpose
Boot-time database maintenance: a consistent `VACUUM INTO` backup on every startup plus threshold-gated compaction that reclaims free pages left by rows deleted during the previous session (conversations, stream events, ...). Best-effort — maintenance never crashes or blocks boot, and in-memory databases are skipped.

## Requirements

### Requirement: StartupMaintenance writes a consistent backup every startup
A `StartupMaintenance` service SHALL run at every server boot and write a consistent, compacted snapshot of the database to `<dbPath>.backup` using `VACUUM INTO` (deleting any stale target first — `VACUUM INTO` fails if the file exists). It SHALL log `[db] Backup created: <path>` on success. The snapshot SHALL include all committed data regardless of WAL state.

#### Scenario: Backup created on boot
- **WHEN** a file-backed server starts
- **THEN** `<dbPath>.backup` exists, contains the same rows as the live database, and a `[db] Backup created:` log line is emitted

#### Scenario: Stale backup is overwritten
- **WHEN** a previous `<dbPath>.backup` exists and the server starts again
- **THEN** the stale snapshot is removed first and the new snapshot is written without error

#### Scenario: Backup includes uncheckpointed WAL data
- **WHEN** the database has committed rows still resident in the WAL
- **THEN** the backup file contains those rows (consistent snapshot, not a raw file copy)

### Requirement: StartupMaintenance reclaims free space when significant
`StartupMaintenance` SHALL run `PRAGMA wal_checkpoint(TRUNCATE)` and then a full `VACUUM` at every boot **when free space is significant** — free pages above 64 MB **or** above 10% of the file (both configurable). When free space is below both thresholds, the full `VACUUM` SHALL be skipped and a "nothing to reclaim" log line emitted. Reclaimed bytes SHALL be logged.

#### Scenario: Reclaim after heavy conversation deletion
- **WHEN** many rows were deleted during the previous session leaving free space above the thresholds
- **THEN** the file shrinks (page_count decreases) and a reclaimed-bytes log line is emitted

#### Scenario: No reclaim when free space is negligible
- **WHEN** free space is below both thresholds at boot
- **THEN** no full `VACUUM` runs and a "nothing to reclaim" log line is emitted

#### Scenario: WAL is checkpointed and truncated each boot
- **WHEN** a file-backed server starts
- **THEN** the WAL is checkpointed with TRUNCATE before the compaction decision

### Requirement: Maintenance is best-effort and skips in-memory databases
Both backup and compaction SHALL catch and log failures (e.g. `SQLITE_BUSY` while another server instance holds the write lock) and SHALL NOT throw or block startup. For in-memory databases (`RAILYN_DB=:memory:`), both phases SHALL be no-ops.

#### Scenario: Locked DB logs a warning and boot continues
- **WHEN** `VACUUM INTO` or `VACUUM` fails (e.g. another instance holds the write lock)
- **THEN** a non-fatal warning is logged and the server continues booting

#### Scenario: In-memory DB skips maintenance
- **WHEN** the database path is `:memory:`
- **THEN** neither a backup file nor a VACUUM is attempted

### Requirement: Backup precedes migrations, compaction follows them
At boot, the consistent backup SHALL run **before** migrations (true pre-change rollback point) and the compaction SHALL run **after** migrations (so pages freed by the migrations themselves are also reclaimed).

#### Scenario: Pending migrations still get a pre-change backup
- **WHEN** pending migrations exist at boot
- **THEN** the backup snapshot reflects the pre-migration state, migrations apply, then compaction runs
