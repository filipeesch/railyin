## Purpose
TBD — provides a background job that periodically cleans up old database rows, moving retention logic off the hot write path.

## Requirements

### Requirement: RetentionJob runs model_raw_messages cleanup periodically
The system SHALL provide a `RetentionJob` that deletes `model_raw_messages` older than 1 day. It SHALL run once on startup (after migrations) and then on a recurring timer (every 5 minutes). The inline `DELETE` in `_persistRawModelMessage` SHALL be removed.

#### Scenario: Startup cleanup runs before first request
- **WHEN** the Bun process starts and migrations complete
- **THEN** `RetentionJob` runs its cleanup query before the HTTP server begins accepting requests

#### Scenario: Periodic cleanup runs every 5 minutes
- **WHEN** the Bun process is running
- **THEN** `model_raw_messages` rows older than 1 day are deleted approximately every 5 minutes

#### Scenario: Hot write path no longer runs DELETE
- **WHEN** a `model_raw_messages` INSERT occurs during streaming
- **THEN** no DELETE query is executed in the same call stack

### Requirement: RetentionJob also cleans expired stream_events
The system SHALL extend `RetentionJob` to also delete `stream_events` for conversations whose last execution completed more than 7 days ago, following the pattern established by migration `030_stream_events_cleanup`.

#### Scenario: Stale stream_events are cleaned
- **WHEN** `RetentionJob` fires
- **THEN** `stream_events` for executions older than 7 days are deleted
