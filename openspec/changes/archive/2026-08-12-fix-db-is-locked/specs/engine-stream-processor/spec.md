## MODIFIED Requirements

### Requirement: Raw message persistence removed, broadcast preserved
The `StreamProcessor` SHALL NOT persist raw model messages to `model_raw_messages` (table dropped). The WS broadcast side-effect previously driven through the raw-message `WriteBuffer.onEnqueue` (i.e. `StreamEventProcessor.onRawMessageEnqueued` for Claude/Copilot chunk events) SHALL be preserved by calling the broadcast callback directly for every raw message. The `WriteBuffer<RawMessageItem>` constructor parameter SHALL be replaced by a plain `onRawMessage(item)` callback.

#### Scenario: Claude/Copilot chunks still broadcast live
- **WHEN** a Claude `content_block_delta` or Copilot `assistant.message_delta` event is produced during streaming
- **THEN** the corresponding `text_chunk`/`reasoning_chunk` stream event is still broadcast over the channel

#### Scenario: No writes to model_raw_messages
- **WHEN** any raw message event is produced during streaming
- **THEN** no INSERT or DELETE query references the `model_raw_messages` table

## ADDED Requirements

### Requirement: StreamProcessor state writes in error paths are best-effort
All DB state writes in `consume()`'s `catch`, `finally`, and abort paths SHALL be wrapped so that a DB error (including SQLITE_BUSY) is logged and never masks the original error or escapes `consume()`.

#### Scenario: Busy error in catch block does not mask the original error
- **WHEN** `consume()` catches an engine failure and the follow-up `UPDATE tasks SET execution_state = 'failed'` throws SQLITE_BUSY
- **THEN** the original failure is still delivered via `onError` and the done stream event, and the DB failure is logged with a label

#### Scenario: finally block DB work is non-fatal
- **WHEN** `consume()`'s `finally` block performs task lookups/updates (e.g. `fetchTaskWithModel`, `needs_column_prompt`, `pending_messages`) and the DB is locked
- **THEN** the failure is logged and `consume()` completes without throwing
