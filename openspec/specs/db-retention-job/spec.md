## Purpose
Provides a background job that periodically cleans up old database rows, moving retention logic off the hot write path. All deletes run in short auto-commit batches so the SQLite write lock is never held for a long transaction, and failures are logged and isolated per phase.

## Requirements

### Requirement: RetentionJob performs batched, error-safe cleanup without model_raw_messages
The `RetentionJob` SHALL delete `stream_events` older than 4 hours and clean up archived chat sessions (archived > 7 days, including dependent `task_execution_checkpoints`, `executions`, and `conversations`) **without** touching `model_raw_messages` (table dropped). Every DELETE SHALL run in short batches (e.g. `LIMIT 500` loops that auto-commit per statement) instead of one long transaction, and every cleanup phase SHALL be wrapped in error handling so a failure is logged and the job continues with the next phase.

#### Scenario: stream_events cleaned in short batches
- **WHEN** `runNow()` executes with 10000 stale `stream_events` rows
- **THEN** rows are deleted in batches of at most 500 with an auto-commit per batch, never in a single long transaction

#### Scenario: model_raw_messages is never touched
- **WHEN** `runNow()` executes
- **THEN** no query references the `model_raw_messages` table

#### Scenario: One phase failing does not abort the job
- **WHEN** the `stream_events` batch delete hits SQLITE_BUSY
- **THEN** the error is logged, remaining `stream_events` batches are skipped for this run, and the archived-chat-session cleanup still executes

### Requirement: RetentionJob first run is deferred off the boot path
`RetentionJob.start()` SHALL NOT run `runNow()` synchronously during server startup. The first cleanup SHALL be scheduled after a startup delay (default 5 minutes), then repeat on the hourly timer. The background loop SHALL catch errors so a failed run never kills the loop.

#### Scenario: Boot does not block on retention cleanup
- **WHEN** the server starts and `retentionJob.start()` is called
- **THEN** no retention DELETE executes synchronously during boot; the first cleanup runs approximately 5 minutes later

#### Scenario: Failed scheduled run does not kill the loop
- **WHEN** a scheduled `runNow()` throws (e.g. SQLITE_BUSY)
- **THEN** the error is logged and the next hourly run still occurs

### Requirement: stream_events retention uses a created_at index
A migration SHALL add `idx_stream_events_created_at ON stream_events(created_at)` so the batched retention DELETE predicate is indexed.

#### Scenario: Retention delete uses the index
- **WHEN** the retention job deletes `stream_events WHERE created_at < now-4h`
- **THEN** the query planner uses `idx_stream_events_created_at` instead of a full table scan
