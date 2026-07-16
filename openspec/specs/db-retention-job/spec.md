## Purpose
TBD — provides a background job that periodically cleans up old database rows, moving retention logic off the hot write path.

## Requirements

### Requirement: RetentionJob runs model_raw_messages cleanup periodically
The system SHALL provide a `RetentionJob` that deletes raw model message debug logs older than 1 day. It SHALL run once on startup (after migrations) and then on a recurring timer (every 5 minutes). The `model_raw_messages` SQLite table and its inline `DELETE` in `_persistRawModelMessage` are removed; cleanup now targets the file-based debug log instead.

#### Scenario: Startup cleanup runs before first request
- **WHEN** the Bun process starts and migrations complete
- **THEN** `RetentionJob` runs its cleanup pass before the HTTP server begins accepting requests

#### Scenario: Periodic cleanup runs every 5 minutes
- **WHEN** the Bun process is running
- **THEN** debug log files older than 1 day are deleted approximately every 5 minutes

#### Scenario: Hot write path no longer runs DELETE
- **WHEN** a raw model message is appended to a debug log during streaming
- **THEN** no SQL DELETE query is executed in the same call stack
