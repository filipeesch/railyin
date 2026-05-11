## Purpose
Pi engine emits real-time context usage after each turn via Pi SDK's `session.getContextUsage()`. The engine exposes `{ tokens, contextWindow, percent }` to Railyin's stream processor so the context gauge receives accurate values for local model sessions.

## Requirements

### Requirement: Usage event emitted after each Pi turn
After each completed turn, `PiEngine` SHALL call `session.getContextUsage()` and emit a `{ type: "usage", inputTokens, outputTokens }` EngineEvent if the token count is known. This feeds the `ContextEstimator` fast path.

#### Scenario: Usage emitted when tokens are known
- **WHEN** Pi SDK emits `turn_end` and `session.getContextUsage()` returns `{ tokens: N }` where N is non-null
- **THEN** a `{ type: "usage", inputTokens: N, outputTokens: 0 }` EngineEvent is pushed to the stream

#### Scenario: Usage not emitted when tokens are unknown
- **WHEN** Pi SDK emits `turn_end` and `session.getContextUsage()` returns `null` or `{ tokens: null }` (e.g., immediately after compaction)
- **THEN** no `usage` EngineEvent is emitted for that turn

### Requirement: Context window size surfaced from provider model list
`PiEngine.listModels()` SHALL surface `contextWindow` from the OpenAI-compatible `/models` endpoint's `context_length` field for each model. This value is available immediately from `listModels()` without requiring a completed turn.

#### Scenario: contextWindow available from model list
- **WHEN** `engine.listModels()` is called
- **AND** the provider's `/models` endpoint returns `{ id, context_length: W }` for a model
- **THEN** the corresponding `EngineModelInfo` includes `contextWindow: W`

#### Scenario: contextWindow absent when provider does not report it
- **WHEN** `engine.listModels()` is called
- **AND** a model entry in the provider's `/models` response has no `context_length` field
- **THEN** the `contextWindow` field is `undefined` on the returned `EngineModelInfo`

#### Scenario: Different models have independent context windows
- **WHEN** two different models (`modelA`, `modelB`) are returned by the provider
- **THEN** `listModels()` returns independent `contextWindow` values for each model
