## ADDED Requirements

### Requirement: CE-1 Fast path — last completed execution `input_tokens`
When the conversation has a completed execution with `input_tokens` set, `estimate(conversationId, maxTokens)` returns that value directly without reading `conversation_messages`.

#### Scenario: Returns execution input_tokens
- **GIVEN** a completed execution with `input_tokens = 5000`
- **WHEN** `estimate(conversationId, 100_000)` is called
- **THEN** returns `5000`

### Requirement: CE-2 Slow path — compaction-anchored, LIMIT 200
When no completed execution exists, `estimate()` finds the last `compaction_summary` message, loads at most 200 `conversation_messages` after it, and applies a type-weighted char heuristic.

#### Scenario: Anchors on last compaction summary
- **GIVEN** a `compaction_summary` at position N and 10 messages after it (no executions)
- **WHEN** `estimate()` is called
- **THEN** only the 10 post-anchor messages are counted (not the summary itself)

#### Scenario: LIMIT caps at 200 messages
- **GIVEN** a `compaction_summary` and 210 messages after it
- **WHEN** `estimate()` is called
- **THEN** only 200 messages are included in the estimate

#### Scenario: Type-weighted heuristic applied
- **GIVEN** messages: 2 tool messages (100 chars each) + 1 user message (100 chars)
- **WHEN** `estimate()` is called
- **THEN** result = `ceil(100/3.5)*2 + ceil(100/4) + OVERHEAD`

### Requirement: CE-3 `maxTokens` cap
`estimate()` never returns a value greater than `maxTokens`.

#### Scenario: Result capped at maxTokens
- **GIVEN** a conversation that would estimate at 50,000 tokens
- **WHEN** `estimate(conversationId, 20_000)` is called
- **THEN** returns `20_000`

### Requirement: CE-4 Empty conversation returns overhead only
- **WHEN** `estimate()` is called on a conversation with no messages and no executions
- **THEN** returns `SYSTEM_MESSAGE_OVERHEAD_TOKENS`
