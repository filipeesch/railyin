## MODIFIED Requirements

### Requirement: StreamEventEnricher assigns blockId and seq
The system SHALL provide a `StreamEventEnricher` class that is the single source of truth for assigning `blockId` and `seq` to stream events. It SHALL have no I/O and no dependency on `Database`. Committed `assistant`/`reasoning` events SHALL reuse the same blockId group as their streamed `text_chunk`/`reasoning_chunk` counterparts so live chunks are replaced consistently, and a `tool_call`/`file_diff` SHALL reset the current text block.

#### Scenario: Text chunks share a block ID
- **WHEN** consecutive `text_chunk` events are processed
- **THEN** all receive the same `blockId` until a `tool_call` or `file_diff` event resets the block

#### Scenario: Committed assistant reuses the text block ID
- **WHEN** a committed `assistant` event is processed after `text_chunk` events in the same text block
- **THEN** it receives the same `blockId` as those `text_chunk` events (so the frontend replaces the live chunk block cleanly)

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
