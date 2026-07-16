## Purpose
TBD — provides a stateful, I/O-free enricher that assigns blockId and seq to stream events, replacing the enrichment responsibility previously held by StreamBatcher.

## Requirements

### Requirement: StreamEventEnricher assigns blockId and seq
The system SHALL provide a `StreamEventEnricher` class that is the single source of truth for assigning `blockId` and `seq` to stream events. It SHALL have no I/O and no dependency on `Database`.

#### Scenario: Text chunks share a block ID
- **WHEN** consecutive `text_chunk` events are processed
- **THEN** all receive the same `blockId` until a `tool_call` or `file_diff` event resets the block

#### Scenario: Tool call resets text block
- **WHEN** a `tool_call` event is processed
- **THEN** the current text block ID is reset and the next `text_chunk` starts a new block

#### Scenario: Reasoning chunks share a block ID
- **WHEN** consecutive `reasoning_chunk` events are processed
- **THEN** all receive the same `blockId` until the block type changes

#### Scenario: Seq numbers are monotonically increasing
- **WHEN** `enrich(event)` is called multiple times on the same enricher instance
- **THEN** each enriched event has a `seq` value strictly greater than the previous

### Requirement: StreamBatcher is replaced by StreamEventEnricher + WriteBuffer
The `StreamBatcher` class SHALL be deleted. Its enrichment responsibility is retained by `StreamEventEnricher`, which continues to assign `blockId`/`seq` to every stream event for the in-memory WebSocket broadcast (the frontend uses these to group live tool/reasoning rows). Its former batching-for-persistence responsibility (feeding `WriteBuffer<PersistedStreamEvent>`) is removed entirely, since `stream_events` persistence is dropped.

#### Scenario: No onFlush callback needed
- **WHEN** stream events are processed
- **THEN** the WS broadcast happens directly in `onStreamEvent` after enrichment, without any callback from a persistence buffer

#### Scenario: StreamBatcher no longer exists
- **WHEN** the codebase is built
- **THEN** no import of `StreamBatcher` exists outside of test files that verify its removal

#### Scenario: Enrichment still runs for the live broadcast path
- **WHEN** a stream event is about to be broadcast over the WebSocket
- **THEN** `StreamEventEnricher.enrich()` still assigns it a `blockId` and monotonically increasing `seq`, exactly as before this change

#### Scenario: Enricher output is no longer written to a persistence buffer
- **WHEN** an event has been enriched
- **THEN** the enriched event is broadcast over the WebSocket only; it is not also handed to a `WriteBuffer<PersistedStreamEvent>` for SQLite persistence
