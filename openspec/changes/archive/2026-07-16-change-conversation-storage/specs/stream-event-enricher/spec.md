## MODIFIED Requirements

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
