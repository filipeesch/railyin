## 1. ProviderError class

- [x] 1.1 Create `src/bun/ai/retry.ts` and define `class ProviderError extends Error` with `status: number` and `retryAfter?: number` fields
- [x] 1.2 Export `ProviderError` from `src/bun/ai/index.ts` (or barrel as appropriate)

## 2. Provider error throw updates

- [x] 2.1 Update `AnthropicProvider` in `src/bun/ai/anthropic.ts` to throw `ProviderError` (with `status` and parsed `retryAfter` from `retry-after` header) on every non-2xx HTTP response instead of a plain `Error`
- [x] 2.2 Update `OpenAICompatibleProvider` in `src/bun/ai/openai-compatible.ts` to throw `ProviderError` (with `status` and parsed `retryAfter`) on every non-2xx HTTP response instead of a plain `Error`

## 3. StreamEvent status type

- [x] 3.1 Add `{ type: "status"; content: string }` to the `StreamEvent` union in `src/bun/ai/types.ts`
- [x] 3.2 Update `onToken` callback signature (or its consumer in engine.ts) to pass an `isStatus?: boolean` flag so the engine can skip DB writes for status events

## 4. retryStream implementation

- [x] 4.1 Implement `retryStream()` async generator in `src/bun/ai/retry.ts` — wraps `provider.stream()`, accepts `maxStreamRetries` (default 3), uses `ProviderError.status` for retryable-status check, implements `min(500ms × 2^attempt, 32000ms) + jitter` backoff with `retryAfter` override, caps 529 at 3 separate retries
- [x] 4.2 Implement the idle watchdog inside `retryStream()` — start/reset a `setTimeout` on each `yield`, 90s default (respects `RAILYN_STREAM_IDLE_TIMEOUT_MS` env var), abort via `new DOMException("stream idle timeout", "AbortError")` on a dedicated `AbortController`; use 30s threshold for stall warning log
- [x] 4.3 Implement `AbortSignal.any([userSignal, watchdogSignal])` combination inside `retryStream()` so either signal terminates the underlying `provider.stream()` call
- [x] 4.4 Implement watchdog-abort discrimination in `retryStream()` catch block — `err instanceof DOMException && err.message === "stream idle timeout"` is watchdog (retryable); any other `AbortError` is user cancel (propagate immediately)
- [x] 4.5 Implement non-streaming fallback path in `retryStream()` — after `maxStreamRetries` exhausted, call `provider.turn()` with the same messages/options and wrap in the turn retry loop (`maxTurnRetries`, default 10); yield the full text response as a synthetic event stream (`text_delta` + `done`)
- [x] 4.6 Implement ephemeral status event emission in the non-streaming fallback path at 15s, 30s, 60s, and 120s thresholds using `yield { type: "status", content: "..." }` with progressively more descriptive messages

## 5. retryTurn implementation

- [x] 5.1 Implement `retryTurn()` async function in `src/bun/ai/retry.ts` — wraps `provider.turn()` with the same `ProviderError`-based backoff and retry cap (separate `maxTurnRetries`); no watchdog; per-request 300s `AbortSignal` timeout already supplied to `provider.turn()`

## 6. Engine integration

- [x] 6.1 Update `runExecution()` in `src/bun/workflow/engine.ts` to call `retryStream()` instead of `provider.stream()` directly; thread the user-cancel `AbortSignal` through to `retryStream()`
- [x] 6.2 Update `runSubExecution()` (or equivalent sub-agent streaming path) in `engine.ts` to call `retryStream()` instead of `provider.stream()` directly
- [x] 6.3 Update `compactConversation()` in `engine.ts` to call `retryTurn()` instead of `provider.turn()` directly
- [x] 6.4 Update any other `provider.turn()` call sites in `engine.ts` to use `retryTurn()`
- [x] 6.5 Update the `onToken` handler in `engine.ts` to skip DB writes for events where `isStatus === true`

## 7. Frontend status message display

- [x] 7.1 Update the frontend event handler (in the task detail view / streaming consumer) to recognise `{ type: "status" }` events and render them as ephemeral muted lines distinct from normal tokens
- [x] 7.2 Clear all ephemeral status lines from the frontend when the actual model response start token arrives

## 8. Tests

- [x] 8.1 Write unit tests for `retryStream()` retry logic — verify backoff delays, 529 cap-at-3, `retryAfter` respected, non-retryable statuses propagate immediately (use fake provider that throws `ProviderError` on demand)
- [x] 8.2 Write unit tests for watchdog behaviour in `retryStream()` — verify watchdog-abort leads to retry, user-abort propagates, stall warning is logged at 30s
- [x] 8.3 Write unit tests for non-streaming fallback — verify `provider.turn()` is called after stream retry exhaustion, status events emitted at correct thresholds, response correctly yielded
- [x] 8.4 Write unit tests for `retryTurn()` — verify retry on 529, backoff, propagation after exhaustion
- [x] 8.5 Update existing engine tests that mock `provider.stream()` / `provider.turn()` to throw `ProviderError` instead of plain `Error` where the test exercises error handling paths
