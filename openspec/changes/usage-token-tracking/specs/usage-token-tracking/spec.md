## Purpose
Usage token tracking captures accurate per-execution token counts from AI provider responses. The data enables an accurate context gauge, validates prompt caching effectiveness, and provides the foundation for future cost reporting.

## Requirements

### Requirement: Providers emit a usage event during streaming
Both `AnthropicProvider` and `OpenAICompatibleProvider` SHALL emit a `{ type: "usage" }` `StreamEvent` once per streaming response. The event contains: `inputTokens`, `outputTokens`, and optionally `cacheCreationInputTokens` and `cacheReadInputTokens`.

#### Scenario: Anthropic usage event emitted from message_start
- **WHEN** the Anthropic streaming response begins with a `message_start` SSE event
- **THEN** the provider emits `{ type: "usage", inputTokens: N, outputTokens: 0, cacheCreationInputTokens?: C, cacheReadInputTokens?: R }` immediately

#### Scenario: Anthropic output tokens updated from message_delta
- **WHEN** Anthropic's `message_delta` event arrives with a final `usage.output_tokens` count
- **THEN** the provider emits a second `{ type: "usage", outputTokens: N }` event with the final output count (or the engine overwrites the earlier incomplete record)

#### Scenario: OpenAI-compatible usage event emitted from final chunk
- **WHEN** an OpenAI-compatible streaming response includes a final chunk with `usage: { prompt_tokens, completion_tokens }`
- **THEN** the provider emits `{ type: "usage", inputTokens: prompt_tokens, outputTokens: completion_tokens }` as the last event before `done`

#### Scenario: OpenAI-compatible provider without usage chunk does not emit usage event
- **WHEN** an OpenAI-compatible provider's stream contains no `usage` chunk
- **THEN** no `{ type: "usage" }` event is emitted; the engine context gauge falls back to character-count estimation

### Requirement: Non-streaming turn results include usage
`AITurnResult` SHALL include an optional `usage` field. When the provider's non-streaming response contains token counts, they SHALL be populated. The engine uses this for compaction calls.

#### Scenario: Anthropic non-streaming turn returns usage in result
- **WHEN** `provider.turn()` completes successfully with an Anthropic provider
- **THEN** the returned `AITurnResult` contains `usage: { inputTokens, outputTokens }` extracted from the response `usage` field

### Requirement: Usage is persisted to the executions table
The engine SHALL write token counts to the `executions` table when a usage event is received during streaming or when a `turn()` with usage completes. The `execution_usage` data persists across restarts and is used by the context gauge RPC.

#### Scenario: Execution row updated with token counts after stream
- **WHEN** an AI streaming execution completes and a usage event was received
- **THEN** the `executions` row for that execution has `input_tokens`, `output_tokens`, and any available cache token counts populated

#### Scenario: Context gauge uses actual token counts when available
- **WHEN** `tasks.contextUsage` is called for a task whose most recent execution has `input_tokens` populated
- **THEN** the returned `usedTokens` equals the actual `input_tokens` from the execution rather than the character-count estimate

#### Scenario: Context gauge falls back to estimate when no usage data
- **WHEN** `tasks.contextUsage` is called and the task has no completed executions with usage data
- **THEN** the returned `usedTokens` uses the existing character-count estimate
