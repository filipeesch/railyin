## Purpose
TBD — provides a stateful, I/O-free enricher that assigns blockId and seq to stream events, replacing the enrichment responsibility previously held by StreamBatcher.

## Requirements

### Requirement: StreamEventEnricher assigns blockId and seq
The system SHALL provide a `StreamEventEnricher` class that is the single source of truth for assigning `blockId` and `seq` to stream events. It SHALL have no I/O and no dependency on `Database`.

#### Scenario: Committed assistant reuses the text block ID
- **WHEN** a committed `assistant` event is processed after `text_chunk` events in the same text block
- **THEN** it receives the same `blockId` as those `text_chunk` events (so the frontend replaces the live chunk block cleanly)

#### Scenario: Text chunks share a block ID
- **WHEN** consecutive `text_chunk` events are processed
- **THEN** all receive the same `blockId` until a `tool_call` or `file_diff` event resets the block

#### Scenario: Tool call resets text block
- **WHEN** a `tool_call` event is processed
- **THEN** the current text block ID is reset and the next `text_chunk` starts a new block

#### Scenario: Reasoning chunks share a block ID
- **WHEN** consecutive `reasoning_chunk` events are processed
- **THEN** all receive the same `blockId` until the block type changes

#### Scenario: Committed reasoning reuses the reasoning block ID
- **WHEN** a committed `reasoning` event is processed after `reasoning_chunk` events in the same reasoning block
- **THEN** it receives the same `blockId` as those `reasoning_chunk` events (so the frontend replaces the live reasoning chunk block cleanly, and reasoning is not dropped or reordered)

#### Scenario: Seq numbers are monotonically increasing
- **WHEN** `enrich(event)` is called multiple times on the same enricher instance
- **THEN** each enriched event has a `seq` value strictly greater than the previous

### Requirement: StreamBatcher is replaced by StreamEventEnricher + WriteBuffer
The `StreamBatcher` class SHALL be deleted. Its responsibilities SHALL be split between `StreamEventEnricher` (enrichment) and `WriteBuffer<PersistedStreamEvent>` (batching).

#### Scenario: No onFlush callback needed
- **WHEN** stream events are processed
- **THEN** the WS broadcast happens directly in `onStreamEvent` before enrichment, without any callback from the buffer

#### Scenario: StreamBatcher no longer exists
- **WHEN** the codebase is built
- **THEN** no import of `StreamBatcher` exists outside of test files that verify its removal
