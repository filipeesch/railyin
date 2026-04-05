## Context

Token usage data is available in every Anthropic API response: `message_start` SSE event carries `{ input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }` in the streaming path; the non-streaming response body includes the same fields under `usage`. OpenAI-compatible providers include `{ prompt_tokens, completion_tokens }` in the final streaming chunk (or in the non-streaming response).

Today the context gauge estimates token usage from character counts (`chars / 4`). This is inaccurate — code, JSON, and tool outputs are token-dense, while natural language is token-sparse. Actual usage from the API eliminates this ambiguity and also validates that prompt caching (T3) is working by exposing `cache_read_input_tokens > 0`.

## Goals / Non-Goals

**Goals:**
- Capture per-execution token counts from both streaming and non-streaming API calls
- Emit a `{ type: "usage" }` StreamEvent from both Anthropic and OpenAI-compatible `stream()` methods
- Persist usage to the `executions` table (new columns); the engine reads it for context gauge
- Replace character-count estimate in context gauge with actual per-execution usage when available
- Surface `cache_read_input_tokens` in usage for T3 validation

**Non-Goals:**
- Per-turn cost display in the UI (this can build on top once usage is persisted)
- Real-time usage streaming to the frontend during execution (usage emitted once, at start of stream)
- Aggregating usage across multiple executions for billing dashboard

## Decisions

### D1: Usage as a `StreamEvent` — emitted once at stream start

Anthropic's `message_start` event (the very first SSE event) contains the input token count, so we emit the `usage` event immediately at stream start while output tokens accumulate. OpenAI-compatible providers emit usage in the final chunk; we emit the event at stream end.

The `usage` StreamEvent is provider-produced, not retry-layer-produced, so it passes through `retryStream` transparently (it's handled exactly like any other `StreamEvent`).

### D2: Extend `AITurnResult` with optional `usage` field

For non-streaming `turn()` calls (compaction, sub-agents), the `AITurnResult` type gains `usage?: UsageStats`. `retryTurn()` passes this through unmodified.

```typescript
interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}
```

OpenAI-compatible: field names map `prompt_tokens → inputTokens`, `completion_tokens → outputTokens`. No cache fields.

### D3: Usage persisted to the `executions` table via new columns

Engine handles `usage` events in the stream loop identically to `status` events — not stored in the conversation, not forwarded to the streaming bubble. Instead, `usage` data is written to the `executions` table:

```sql
ALTER TABLE executions ADD COLUMN input_tokens INTEGER;
ALTER TABLE executions ADD COLUMN output_tokens INTEGER;
ALTER TABLE executions ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE executions ADD COLUMN cache_read_input_tokens INTEGER;
```

The `tasks.contextUsage` RPC reads the most recent completed execution for the task and returns its `input_tokens` as the actual usage when present, otherwise falls back to the character estimate.

### D4: Context gauge uses actual token count when available

`estimateContextUsage()` in `engine.ts` currently returns a character-based estimate. It gains a check: if the task's most recent execution has `input_tokens IS NOT NULL`, return that value directly (plus the fixed system-message overhead approximation). The `fraction` calculation stays the same.

The existing RPC shape `{ usedTokens, maxTokens, fraction }` is unchanged — the frontend requires no update.

## Risks / Trade-offs

- **Usage event timing (Anthropic)**: `message_start` gives input tokens but `output_tokens` may be 0 at stream start (it reflects the count so far). We store the final usage from the `message_delta` event (which carries `usage.output_tokens`) or fall back to the `message_start` value. The engine should update the row when a final usage arrives.
- **Missing usage on old executions**: adding nullable columns is safe; old rows are NULL and fall back to estimates.
- **OpenAI-compatible field availability**: not all providers include `usage` in streaming chunks. If absent, the usage event is not emitted and the row stays NULL; gauge falls back to estimate.
