## Purpose
The api-resilience capability wraps every AI provider call with automatic retry, idle-stream watchdog, non-streaming fallback, and ephemeral status feedback. All protection is implemented at the `AIProvider` interface boundary so it applies uniformly to Anthropic, OpenAI-compatible, and any future provider without changes to provider internals.

## Requirements

### Requirement: Provider errors carry a structured HTTP status code
The system SHALL define `class ProviderError extends Error` with a numeric `status` field and an optional `retryAfter` field (seconds from the `retry-after` response header). Both `AnthropicProvider` and `OpenAICompatibleProvider` SHALL throw `ProviderError` (never a plain `Error`) for any non-2xx HTTP response. The retry wrapper catches only `ProviderError` for status-aware branching; all other errors propagate immediately.

#### Scenario: Provider throws structured error on HTTP 429
- **WHEN** the upstream API returns HTTP 429 with a `retry-after: 30` header
- **THEN** the provider throws `ProviderError` with `status: 429` and `retryAfter: 30`

#### Scenario: Provider throws structured error on HTTP 529
- **WHEN** the upstream Anthropic API returns HTTP 529 (overloaded)
- **THEN** the provider throws `ProviderError` with `status: 529`

#### Scenario: Non-HTTP errors propagate unmodified
- **WHEN** a network connection error occurs (e.g., DNS failure, TCP reset)
- **THEN** the original error propagates without being wrapped in `ProviderError`

### Requirement: Transient API errors are retried with exponential backoff
The system SHALL retry `ProviderError` with `status` in `[429, 529, 500, 502, 503, 504]` up to a configurable maximum. Backoff delay is `min(500ms × 2^attempt, 32000ms)` plus uniform jitter in `[0, 1000ms]`. If the error carries `retryAfter`, the delay SHALL be `max(computed backoff, retryAfter × 1000ms)`. Status 529 is limited to a separate maximum of 3 retries regardless of the global retry cap.

#### Scenario: 429 rate-limit retried with backoff
- **WHEN** the provider throws `ProviderError` with `status: 429` and no `retryAfter`
- **THEN** the wrapper waits the computed backoff duration and retries the call

#### Scenario: retry-after header respected
- **WHEN** the provider throws `ProviderError` with `status: 429` and `retryAfter: 60`
- **THEN** the wrapper waits at least 60 seconds before the next attempt

#### Scenario: 529 overloaded capped at 3 retries
- **WHEN** the provider throws `ProviderError` with `status: 529` on three consecutive attempts
- **THEN** no further retries are made and the error is re-thrown after the third attempt

#### Scenario: Non-retryable status propagates immediately
- **WHEN** the provider throws `ProviderError` with `status: 400`
- **THEN** the wrapper does not retry and re-throws immediately

### Requirement: Streaming idle watchdog detects and recovers from stalled streams
The system SHALL start a watchdog timer each time a `provider.stream()` call begins and reset it on every yielded SSE event. If no event arrives within the idle timeout (default 90 seconds, configurable via `RAILYN_STREAM_IDLE_TIMEOUT_MS`), the watchdog aborts the stream by signalling a dedicated internal `AbortController` with `new DOMException("stream idle timeout", "AbortError")` as the abort reason. A secondary 30-second stall threshold SHALL log a warning without aborting. A watchdog-triggered abort is treated as a retryable failure by the stream retry loop.

#### Scenario: Watchdog fires after 90 seconds of silence
- **WHEN** a streaming response produces no SSE events for 90 consecutive seconds
- **THEN** the watchdog aborts the stream and the retry wrapper attempts a fresh stream call

#### Scenario: Watchdog reset on each event
- **WHEN** a streaming response produces SSE events continuously
- **THEN** the watchdog timer is reset on every event and never fires

#### Scenario: Watchdog abort is distinguished from user cancellation
- **WHEN** the watchdog fires an abort using `new DOMException("stream idle timeout", "AbortError")`
- **THEN** the retry wrapper identifies it as a watchdog abort (`err instanceof DOMException && err.message === "stream idle timeout"`) and retries rather than propagating as user cancellation

#### Scenario: User abort propagates immediately
- **WHEN** the user cancels the execution and the user-supplied `AbortSignal` fires
- **THEN** the stream terminates and the cancellation propagates without retry

#### Scenario: Stall warning logged at 30 seconds
- **WHEN** a streaming response produces no SSE events for 30 consecutive seconds but fewer than 90
- **THEN** a warning is logged to the server log with the provider name and elapsed time; the stream continues

### Requirement: Failed streaming falls back to non-streaming after retry exhaustion
The system SHALL attempt up to `maxStreamRetries` (default 3) streaming retries. After exhaustion, `retryStream()` SHALL call `provider.turn()` for the same messages and options (non-streaming path). The non-streaming call is wrapped with its own retry loop (`maxTurnRetries`, default 10) and a per-request timeout (default 300 seconds). If both the stream retry loop and the non-streaming retry loop are exhausted without success, the error is re-thrown and the task transitions to `failed`.

#### Scenario: Fallback activates after 3 stream failures
- **WHEN** `provider.stream()` fails on three consecutive attempts (any retryable status or watchdog)
- **THEN** `retryStream()` switches to calling `provider.turn()` for the same messages

#### Scenario: Non-streaming fallback succeeds
- **WHEN** `provider.turn()` returns a complete response during fallback
- **THEN** the response is yielded as a single `text_delta` event followed by `done`, and the task continues normally

#### Scenario: Total exhaustion marks task as failed
- **WHEN** both stream retries and non-streaming retries are exhausted
- **THEN** the error is re-thrown, the engine catches it, and the task is set to `failed` with an error system message

### Requirement: Ephemeral status events communicate non-streaming wait time to the user
The system SHALL yield `{ type: "status", content: string }` stream events during non-streaming fallback at fixed time thresholds (15s, 30s, 60s, 120s after fallback begins). The engine SHALL forward these events to the `onToken` callback with an `isStatus: true` flag. Status events SHALL NOT be written to the database or appended to conversation history. The frontend SHALL display them as ephemeral muted lines (similar in style to reasoning lines) that are removed when the actual response arrives.

#### Scenario: Status message emitted after 15 seconds
- **WHEN** the non-streaming fallback call has been pending for 15 seconds
- **THEN** a `{ type: "status", content: "Waiting for response…" }` event is yielded to the frontend

#### Scenario: Status messages escalate over time
- **WHEN** the non-streaming fallback call reaches 30, 60, and 120 second thresholds
- **THEN** progressively more descriptive status messages are yielded (e.g., "Model is taking longer than usual…", "Still waiting — the provider may be under heavy load…")

#### Scenario: Status message cleared on response arrival
- **WHEN** the non-streaming fallback call completes and the response text is yielded
- **THEN** the frontend removes all ephemeral status lines and displays only the model's response

#### Scenario: Status events not persisted
- **WHEN** a status event is emitted during fallback
- **THEN** no database write occurs for that event and it does not appear in stored conversation history

### Requirement: retryTurn wraps non-streaming calls with the same backoff
The system SHALL expose `retryTurn()` as an async function (not a generator) that wraps `provider.turn()` with the same `ProviderError`-based backoff. `retryTurn()` is used by `compactConversation()` and any sub-execution path that already calls `provider.turn()` directly. No watchdog is applied inside `retryTurn()` — the 300-second AbortSignal timeout on each individual request is sufficient.

#### Scenario: compactConversation retries on 529
- **WHEN** `compactConversation()` calls `retryTurn()` and the provider returns HTTP 529
- **THEN** the call is retried with exponential backoff up to the configured maximum

#### Scenario: retryTurn propagates after max retries
- **WHEN** all `retryTurn()` attempts are exhausted
- **THEN** the error propagates to the caller, which handles it (e.g., marks compaction as failed)

### Requirement: Retry and watchdog apply uniformly across all configured providers
The system SHALL apply `retryStream()` and `retryTurn()` at the `AIProvider` interface layer so that the same resilience behaviour is in effect for every provider: Anthropic, OpenAI-compatible (OpenRouter, LM Studio, Ollama), and any future provider. No provider-specific retry or watchdog logic SHALL exist inside individual provider implementations.

#### Scenario: OpenRouter 503 is retried
- **WHEN** an `OpenAICompatibleProvider` configured with OpenRouter returns HTTP 503
- **THEN** the retry wrapper retries with backoff just as it would for any other provider

#### Scenario: LM Studio stream stall is watchdog-terminated
- **WHEN** an `OpenAICompatibleProvider` configured with LM Studio stalls mid-stream for 90 seconds
- **THEN** the watchdog fires, the stream restarts, and the task is not left hanging
