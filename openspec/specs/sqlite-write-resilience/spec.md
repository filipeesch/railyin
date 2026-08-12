## Purpose
Keeps the SQLite connection and the stream execution error paths resilient to lock contention (`SQLITE_BUSY`) when several server processes share one database file (WAL, one writer at a time).

## Requirements

### Requirement: SQLite connection tuned for multi-process WAL contention
The shared SQLite connection (`getDb()` in `src/bun/db/index.ts`) SHALL set `PRAGMA busy_timeout = 20000` (20 seconds), `PRAGMA synchronous = NORMAL`, and `PRAGMA journal_size_limit = 67108864` (64 MB) in addition to the existing WAL and foreign_keys pragmas. These apply on connection creation and SHALL NOT change the connection's public API.

#### Scenario: busy_timeout raised to 20 seconds
- **WHEN** a second writer holds the SQLite write lock while this process performs a write
- **THEN** the write waits up to 20000 ms for the lock instead of the previous 5000 ms before throwing SQLITE_BUSY

#### Scenario: WAL stays enabled with bounded growth
- **WHEN** the connection is created
- **THEN** `journal_mode` is `WAL`, `synchronous` is `NORMAL`, and the WAL file is capped at approximately 64 MB by `journal_size_limit`

### Requirement: Execution error paths use best-effort DB writes
`StreamProcessor.consume()` SHALL wrap every DB state write in its `catch`, `finally`, and abort paths (task/chat-session/execution status updates, `needs_column_prompt`, `pending_messages` handling) in a best-effort helper that catches and logs errors instead of rethrowing. A SQLITE_BUSY (or any DB error) during failure handling SHALL NOT mask the original error being handled, and SHALL NOT escape `consume()`.

#### Scenario: Busy error during failure handling is absorbed
- **WHEN** `consume()` catches an engine error and its own `UPDATE tasks SET execution_state = 'failed'` hits SQLITE_BUSY
- **THEN** the original error is still reported via `onError`/`onStreamEvent`, the DB failure is logged with its label, and `consume()` does not throw

#### Scenario: finally-block DB work cannot crash consume
- **WHEN** `consume()`'s `finally` block performs task lookups/updates and the DB is locked
- **THEN** the failure is logged and the `finally` block completes without throwing

### Requirement: Boot phase-timing markers
`src/bun/index.ts` SHALL log `[boot] <phase> <elapsed-ms>` markers around each startup phase (process start, shell-env resolution, migrations, config/workspace loading, engine construction, retention job start, HTTP server bind) so startup latency can be attributed per phase from the server log.

#### Scenario: Boot phases are attributed in the log
- **WHEN** the server starts
- **THEN** the log contains a `[boot]` line per phase with the elapsed milliseconds since process start, ending with the server-listen marker
