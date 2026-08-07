## ADDED Requirements

### Requirement: Committed reasoning flush uses enricher-aligned blockId
When the stream processor flushes accumulated `reasoning` content as a committed `reasoning` stream event (before a `tool_start`, on `done`, or on cancel), it SHALL let the `StreamEventEnricher` assign the reasoning blockId so it matches the `reasoning_chunk` events streamed earlier in that reasoning block, and SHALL emit it at the correct position relative to the tool call so live reasoning is neither dropped nor reordered.

#### Scenario: Reasoning flushed before tool_start uses the same blockId as streamed chunks
- **WHEN** a `tool_start` event is received while `reasoningAccum` is non-empty
- **THEN** the accumulated reasoning is emitted as a committed `reasoning` stream event whose `blockId` is the enricher's reasoning block id (the same block the `reasoning_chunk` events were streamed into)
- **AND** the committed reasoning is emitted before the `tool_call` event, so it is inserted where the reasoning chunk was rather than appended out of order

#### Scenario: No divergent hardcoded reasoning blockId
- **WHEN** the stream processor flushes committed reasoning
- **THEN** it does not emit a hardcoded `${executionId}-pre-r${n}` blockId that diverges from the enricher's `{executionId}-r{n}` reasoning block

#### Scenario: Non-Cursor engines are unaffected
- **WHEN** Claude, Copilot, or Pi executions emit stream events
- **THEN** their committed reasoning/assistant blockId emission is unchanged by this alignment
