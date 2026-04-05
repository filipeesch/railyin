## 1. Types

- [ ] 1.1 Add `UsageStats` interface to `types.ts`: `{ inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }`
- [ ] 1.2 Add `{ type: "usage"; usage: UsageStats }` to the `StreamEvent` discriminated union in `types.ts`
- [ ] 1.3 Extend `AITurnResult` in `types.ts` with `usage?: UsageStats`

## 2. Anthropic Provider

- [ ] 2.1 Parse `message_start` SSE event in `anthropic.ts` `stream()` and yield a `{ type: "usage" }` event with `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`
- [ ] 2.2 Parse `message_delta` stop event in `anthropic.ts` `stream()` and include `output_tokens` in the emitted usage event (merge with input stats from step 2.1)
- [ ] 2.3 Populate `usage` on the `AITurnResult` returned from `anthropic.ts` `turn()` (non-streaming path: read from response body `usage` field)

## 3. OpenAI-Compatible Provider

- [ ] 3.1 Detect the final chunk with `usage: { prompt_tokens, completion_tokens }` in `openai-compatible.ts` `stream()` and yield a `{ type: "usage" }` event
- [ ] 3.2 Populate `usage` on the `AITurnResult` returned from `openai-compatible.ts` `turn()` (non-streaming path: read from response body `usage` field)

## 4. Database Persistence

- [ ] 4.1 Write a migration adding four nullable integer columns to the `executions` table: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- [ ] 4.2 Handle the `{ type: "usage" }` stream event in the engine's stream loop: write token columns to the `executions` row for the current execution (do not write a conversation message)

## 5. Context Gauge Integration

- [ ] 5.1 Update `estimateContextUsage()` (or equivalent) to read `input_tokens` from the most recent `executions` row when available
- [ ] 5.2 Fall back to the existing character-count estimation when `input_tokens` is null

## 6. Tests

- [ ] 6.1 Write unit tests for Anthropic usage event parsing: verify both `message_start` and `message_delta` values are merged correctly
- [ ] 6.2 Write unit tests for the context gauge: actual-token path and fallback path
- [ ] 6.3 Write unit tests for the OpenAI-compatible usage chunk handling
