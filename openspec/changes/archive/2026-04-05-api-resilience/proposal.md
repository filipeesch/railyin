## Why

AI provider calls (streaming and non-streaming) have no retry, timeout, or fallback protection. A single transient 429, 529, or mid-stream connection drop fails the task permanently. Local providers (LM Studio, Ollama) are especially prone to stream stalls during model loading or GPU memory pressure. This leaves tasks stuck in `failed` or `running` states with no recovery path.

## What Changes

- **New `ProviderError` class** in each provider: structured error with `status` and optional `retryAfter` field, replacing raw `new Error("HTTP 429: ...")` strings.
- **New `retryStream()` utility** (`src/bun/ai/retry.ts`): provider-agnostic async generator that wraps `provider.stream()` with retry logic, streaming idle watchdog, and non-streaming fallback.
- **Streaming idle watchdog**: aborts and retries a stalled SSE stream after 90 seconds of no events.
- **Non-streaming fallback**: after 3 stream retry failures, falls back to `provider.turn()` (blocking, 300s timeout) with ephemeral "thinking..." status messages surfaced in the UI.
- **Retry loop**: up to 10 attempts with exponential backoff (500ms base, 32s cap) on 429, 529, and 5xx errors; parses `retry-after` header when present.
- **Engine integration**: `runExecution()` and `runSubExecution()` use `retryStream()` instead of calling `provider.stream()` directly.
- **Compaction integration**: `compactConversation()` wraps `provider.turn()` with the same retry logic via a `retryTurn()` helper.

## Capabilities

### New Capabilities
- `api-resilience`: Retry, watchdog, and non-streaming fallback for all AI provider calls. Applies uniformly across Anthropic, OpenRouter, LM Studio, and any future provider.

### Modified Capabilities
- `ai-provider`: `AIProvider` interface requires providers to throw `ProviderError` (structured) instead of generic errors. Retry and watchdog responsibility moves from providers to the new transport layer.

## Impact

- `src/bun/ai/anthropic.ts` — throw `ProviderError` instead of `Error`
- `src/bun/ai/openai-compatible.ts` — throw `ProviderError` instead of `Error`
- `src/bun/ai/retry.ts` — new file: `retryStream()`, `retryTurn()`, `ProviderError`
- `src/bun/ai/types.ts` — add `status` event type for ephemeral UI messages
- `src/bun/workflow/engine.ts` — use `retryStream()` in `runExecution()` and `runSubExecution()`
- `src/bun/workflow/engine.ts` — use `retryTurn()` in `compactConversation()`
- Frontend: handle `status` stream event to display ephemeral "thinking..." lines during non-streaming fallback
