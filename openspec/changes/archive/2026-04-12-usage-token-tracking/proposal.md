## Why

No usage data is captured from API responses today. The context gauge estimates token usage from character counts (`chars / 4`), which is inaccurate (especially for code and tool outputs). Anthropic's `message_start` SSE event and non-streaming response body both include exact token counts: `input_tokens`, `output_tokens`, and — when prompt caching is active — `cache_creation_input_tokens` and `cache_read_input_tokens`. Capturing these makes the context gauge accurate, enables per-turn cost display, and provides the only reliable way to verify that prompt caching (T3) is working.

## What Changes

- **New `{ type: "usage" }` `StreamEvent`**: emitted once per stream response, immediately after the `message_start` SSE event from Anthropic or equivalent chunk from OpenAI-compatible providers.
- **Usage fields**: `inputTokens`, `outputTokens`, `cacheCreationInputTokens?`, `cacheReadInputTokens?`.
- **`AITurnResult` usage extension**: non-streaming `turn()` responses include the same `usage` field in the returned value.
- **Context gauge improvement**: `estimateContextUsage()` in `engine.ts` augments its character-count estimate with actual usage when a usage event is present for the most recent execution.
- **OpenAI-compatible support**: the `usage` field from OpenAI's final streaming chunk (or non-streaming response body) is mapped to the same `StreamEvent`.

## Capabilities

### New Capabilities
- `usage-token-tracking`: Definition of the `usage` stream event, per-turn token fields, and how usage data flows from provider to context gauge.

### Modified Capabilities
- `context-gauge`: Token estimates are replaced with actual counts when usage data is available; the gauge display may show "exact" vs "estimated" indicators.

## Impact

- `src/bun/ai/types.ts` — add `{ type: "usage"; ... }` to `StreamEvent` union; extend `AITurnResult` with optional `usage`
- `src/bun/ai/anthropic.ts` — parse `message_start` event in `stream()`, emit `usage` event; include usage in `turn()` result
- `src/bun/ai/openai-compatible.ts` — parse final `usage` chunk in `stream()`, emit `usage` event; include usage in `turn()` result
- `src/bun/workflow/engine.ts` — handle `usage` event in stream loop (store per-execution, skip DB write for conversation)
- `src/bun/db/` — new `execution_usage` column or table to persist per-execution token counts
- Frontend context gauge — read actual token counts from execution record
