## Purpose
Provides structured application logging that goes to the file logger instead of a database table. The legacy `logs` table was dropped; `realLogger` writes JSON lines via `console`, which `server/file-logger.ts` captures into `~/.railyn/logs/bun.log` in production.

## Requirements

### Requirement: realLogger writes to the file logger, not the DB
`src/bun/logger.ts` SHALL repoint `realLogger` (and the exported `log` function) from `INSERT INTO logs` to structured file logging: each entry SHALL be written as a JSON line via `console.log` (captured by `server/file-logger.ts` into `~/.railyn/logs/bun.log` in production; visible on the console in dev). The `Logger` interface, `LogOptions`, `noopLogger`, and all existing call sites SHALL remain unchanged. The implementation SHALL NOT depend on `getDb()`.

#### Scenario: Logger entry lands in the file log
- **WHEN** `realLogger.log("warn", "msg", { taskId: 7 })` is called in a production server
- **THEN** a structured line containing `level`, `message`, `taskId`, and a timestamp is written to the file log, and no DB write occurs

#### Scenario: Logger interface unchanged for call sites
- **WHEN** `ai/retry.ts`, `ai/anthropic.ts`, `workflow/session-memory.ts`, or `conversation/context.ts` call `logger.log(...)`
- **THEN** they compile and behave without changes; `noopLogger` still swallows entries

### Requirement: logs table is dropped
A migration (`056_drop_logs_table`) SHALL drop the `logs` table. After the migration, no production code SHALL reference the `logs` table.

#### Scenario: No production references to logs table
- **WHEN** the change is complete
- **THEN** a source search finds no `INSERT INTO logs` or `SELECT ... FROM logs` outside tests/historical migrations
