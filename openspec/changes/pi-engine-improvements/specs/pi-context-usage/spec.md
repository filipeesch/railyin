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

### Requirement: Context window size cached per model
`PiEngine` SHALL maintain an in-memory `Map<qualifiedModelId, contextWindow>` updated on each `turn_end`. The cached value SHALL be surfaced in `listModels()` as `contextWindow` on the matching `EngineModelInfo`.

#### Scenario: contextWindow populated after first turn
- **WHEN** Pi SDK emits `turn_end` and `session.getContextUsage()` returns `{ contextWindow: W }`
- **THEN** `PiEngine` stores `W` for the current `qualifiedModelId`
- **AND** subsequent `listModels()` calls include `contextWindow: W` for that model entry

#### Scenario: contextWindow absent before first turn
- **WHEN** `engine.listModels()` is called before any turn has completed for a given model
- **THEN** the `contextWindow` field is absent or `undefined` on the returned `EngineModelInfo`

#### Scenario: Different models have independent context windows
- **WHEN** two different models (`modelA`, `modelB`) have both completed at least one turn
- **THEN** `listModels()` returns independent `contextWindow` values for each model
