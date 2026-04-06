## Context

AI provider calls in `engine.ts` call `provider.stream()` and `provider.turn()` directly with no retry, timeout, or fallback protection. Any transient HTTP error (429, 529, 5xx) or mid-stream network drop immediate fails the task. Local providers (LM Studio, Ollama) commonly stall SSE streams during model loading, which today causes tasks to hang in `running` state indefinitely.

Both `AnthropicProvider` and `OpenAICompatibleProvider` throw raw `new Error("HTTP 429: ...")` strings, making status-code-aware retry impossible without fragile string parsing.

## Goals / Non-Goals

**Goals:**
- Retry transient HTTP errors (429, 529, 5xx, connection drops) with exponential backoff across all providers
- Detect and recover from stalled SSE streams via an idle watchdog
- Fall back to non-streaming (`provider.turn()`) when streaming repeatedly fails, with ephemeral "thinking..." UI feedback
- Keep the retry/watchdog/fallback layer completely provider-agnostic — benefits Anthropic, OpenRouter, LM Studio, and any future provider equally
- Wrap `retryTurn()` for non-streaming calls too (compaction, sub-agents)

**Non-Goals:**
- Context overflow handling — compaction handles this upstream; we do not retry 400 "context limit" errors
- OAuth token refresh or credential rotation — no auth layer in our providers
- Persistent unattended retry (multi-hour backoff) — out of scope
- Storing "thinking..." status messages in conversation history

## Decisions

### D1: Retry wrapper lives at the AIProvider interface boundary, not inside providers

The retry wrapper (`retryStream`, `retryTurn`) wraps `provider.stream()` / `provider.turn()` calls from outside. Providers remain simple: make the HTTP request, throw `ProviderError` on failure.

**Why not inside the provider?** The engine needs visibility into retry state (to emit status events). The watchdog timer needs to sit colocated with the `for await` loop re-yielding. Provider internals don't have this context.

**Alternative considered:** Retry inside each provider. Rejected because: each provider would duplicate logic, engine can't surface status messages during provider-internal waits, and watchdog can't interleave with the consumer's event loop.

### D2: Structured `ProviderError` class instead of raw Error strings

Both providers will throw `class ProviderError extends Error { status: number; retryAfter?: number }`. The retry wrapper catches only `ProviderError` for status-aware branching; all other errors propagate immediately.

**Why not parse error strings?** Fragile, breaks on message wording changes. Status code is the canonical signal.

### D3: Watchdog timer resets on each re-yielded event inside the retry wrapper

The retry wrapper is a generator that re-yields every event from `provider.stream()`. The watchdog `clearTimeout` + `setTimeout` pair fires on each `yield`. No provider-level callbacks, no heartbeat events added to the stream.

**Watchdog fires:** After 90 seconds of no SSE events, the watchdog aborts the stream using a dedicated internal `AbortController`. The abort reason is a `DOMException("stream idle timeout", "AbortError")` so Bun throws an `Error` (not a string) that is detectable and discriminable from user cancellation.

**Stall logging:** A separate 30s threshold logs a warning but does not abort (mirrors Claude Code's stall detection).

### D4: AbortSignal.any() to combine user-cancel and watchdog signals

`provider.stream()` receives `AbortSignal.any([userSignal, watchdogSignal])`. Either signal aborting terminates the fetch. Bun's `AbortSignal.any()` is confirmed available and functional.

**Discriminating user-cancel from watchdog in catch block:**
- User cancel: `controller.abort()` → Bun throws `{name: "AbortError"}` (no reason, internal error object)
- Watchdog: `controller.abort(new DOMException("stream idle timeout", "AbortError"))` → Bun throws the `DOMException`

Detection: `err instanceof DOMException && err.message === "stream idle timeout"` → watchdog. Otherwise AbortError → user cancel.

### D5: 3 stream retries then non-streaming fallback, up to 10 non-streaming retries

Stream retries are capped at 3 because SSE failures (stalls, 529 during streaming) tend to be persistent within a short window. Non-streaming hits a different code path server-side and often succeeds when streaming is struggling.

Non-streaming fallback (calls `provider.turn()`) runs with a 300s timeout. This is unblocking in nature — no live tokens — but works reliably even under load.

**Why 529 max 3 before fail (Anthropic only)?** After 3 consecutive 529s the server is clearly overloaded. Since 529 only comes from Anthropic, no special-casing is needed for other providers — they never emit 529 so the counter never fires.

### D6: Ephemeral "thinking..." status events, not stored in DB

A new `{ type: "status", content: string }` stream event is yielded during non-streaming fallback waits at fixed time thresholds (15s / 30s / 60s / 120s). The engine forwards these to `onToken` with a new `isStatus: true` flag. The frontend displays them as ephemeral muted lines (similar to reasoning lines) that disappear when the response arrives.

These are never written to the DB — they describe API wait state, not task content.

**Why ephemeral?** They're noise in conversation history. The user cares about "model thought for 2 minutes" only while it's happening.

### D7: retryTurn() wraps provider.turn() with same backoff, no watchdog

`retryTurn()` is a simple async wrapper (not a generator) around `provider.turn()`. It uses the same `ProviderError` + backoff logic. No watchdog is needed — `provider.turn()` sets its own per-request `AbortSignal` timeout (300s default). `retryTurn()` is used by `compactConversation()` and `runSubExecution()`.

## Risks / Trade-offs

**[Partial response on stream retry]** → On stream retry, any `fullResponse` accumulated before the abort is discarded. The engine hasn't written it to DB yet (writes happen at round completion), so liveMessages is unchanged — a clean restart. Acceptable: better to lose a partial response than send a poisoned half-turn to the model.

**[Non-streaming blocks live UI]** → During non-streaming fallback, the user sees no tokens until the full response arrives. Mitigated by the "thinking..." ephemeral status messages. For fast providers this never happens; for slow/overloaded ones it's better than a failed task.

**[Watchdog false-fires on slow local models]** → A model generating at <1 token every 90s (e.g., large model on slow hardware) would trigger the watchdog. The 90s default is configurable via `RAILYN_STREAM_IDLE_TIMEOUT_MS` env var. Users with slow local hardware can raise it.

**[Infinite retry loop if provider never recovers]** → Bounded by `maxStreamRetries: 3` + `maxTurnRetries: 10` hard limits. After exhaustion the task goes to `failed` with a clear error message.

## Migration Plan

No migration needed. All changes are additive:
- `ProviderError` replaces raw `Error` throws — callers that caught `Error` still catch `ProviderError` (it extends `Error`)
- `retryStream()` / `retryTurn()` are drop-in wrappers — engine call sites change only at the call boundary
- The `status` event type is additive — existing event consumers ignore unknown types

## Open Questions

_(none — all decisions made during explore session)_
