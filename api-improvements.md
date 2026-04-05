# Anthropic API Integration Improvements

Gaps identified by comparing our implementation against Claude Code source (`free-code-main`).

---

## 🔴 HIGH — Resilience

### T1: Retry with exponential backoff on API errors
**Current**: Any HTTP error throws immediately → task goes to `failed` state.
**Goal**: Wrap provider `stream()` / `turn()` calls in a retry loop with exponential backoff.
- Handle 429 (rate limit): parse `retry-after` header, wait, retry
- Handle 529 (Anthropic overloaded): max 3 retries, bail immediately for background/non-interactive calls
- Handle transient 5xx: retry with backoff
- Max retries: configurable, default 10
- Base backoff: 500ms with jitter, exponential growth

**Where**: New `src/bun/ai/retry.ts` wrapper, applied in the engine before each `provider.stream()` call.

---

### T2: Streaming idle watchdog + non-streaming fallback
**Current**: `for await` on SSE stream hangs forever if the stream stalls mid-response.
**Goal**: Monitor time between SSE events; abort and retry as non-streaming on stall.
- 30s gap between events → emit warning
- 90s total idle timeout → abort stream
- On abort: retry same request as non-streaming (`stream: false`) with 300s timeout
- This guards both Anthropic and OpenAI-compatible providers

**Where**: Wrap the `for await` loop in `engine.ts`; fallback calls `provider.turn()`.

---

## 🟡 MEDIUM — Cost & Correctness

### T3: Prompt caching via `cache_control` markers
**Current**: Full context (system prompt + tool docs) re-sent every API call at full input token price.
**Goal**: Add `cache_control: { type: "ephemeral" }` to the last system message block in `adaptMessages()`.
- Anthropic charges ~10% for cache-read tokens vs full input price
- The system message (task/board/project context + tool documentation) is large and stable across tool loop rounds
- Only needed for `AnthropicProvider` — OpenAI-compatible providers ignore the field

**Where**: `src/bun/ai/anthropic.ts` → `adaptMessages()`, mark last system block.

---

### T4: Usage token tracking per API call
**Current**: No usage data captured from API responses.
**Goal**: Extract `usage` from Anthropic's `message_start` SSE event and expose it to callers.
- Fields to capture: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- Add to `StreamEvent` as a `{ type: "usage", ... }` event emitted once per stream
- Extend `AITurnResult` with `usage` field for non-streaming calls
- Feed into context gauge (already shows token count — this makes it accurate)
- Optional: show per-turn cost in the UI

**Where**: `src/bun/ai/types.ts` (add events/types), `src/bun/ai/anthropic.ts` (emit on `message_start`), `src/bun/ai/openai-compatible.ts` (emit on `usage` chunk if present).

---

### T5: `is_error: true` flag on failed tool results
**Current**: Tool failures sent back as plain `content` string with no error flag. Model treats them as successful responses.
**Goal**: Set `is_error: true` on `tool_result` content blocks when tool execution fails.
- Anthropic uses this flag to give the model a better signal about error state
- Already tracked internally — just needs to be surfaced in the wire message

**Where**: `src/bun/workflow/tools.ts` and `src/bun/workflow/engine.ts` — where tool results are assembled into messages.

---

### T6: Two-stage (recursive) JSON parsing for streamed tool inputs
**Current**: Tool `input` accumulated as string from `input_json_delta` events, then `JSON.parse()` once.
**Goal**: Use `safeParseJSON()` that handles nested double-encoded JSON from Anthropic's streaming.
- Root cause: Anthropic streaming sometimes wraps the JSON string in an outer string encoding (e.g., `"{\"key\": \"value\"}"`  instead of `{"key": "value"}`)
- Silent failure: `JSON.parse` succeeds but tool receives wrong shape (a string instead of an object)
- Fix: Try parse → if result is a string, parse again → log if final parse fails

**Where**: `src/bun/ai/anthropic.ts` — post-stream tool input finalization.

---

## 🟢 LOWER — Polish & Safety

### T7: Thinking block orphan detection before API send
**Current**: If compaction or an aborted turn leaves consecutive assistant messages with mismatched thinking signatures, next API call returns HTTP 400.
**Goal**: Filter orphaned thinking blocks before assembling the message payload.
- Rule: An assistant message containing ONLY thinking blocks (no text, no tool_use) is orphaned → remove it
- Rule: Strip trailing thinking blocks from the last assistant message in history
- A 400 from this is cryptic and unrecoverable without this guard

**Where**: `src/bun/ai/anthropic.ts` → `adaptMessages()`, add pre-flight filter pass.

---

### T8: Consecutive user message merging
**Current**: Possible to have back-to-back `role: "user"` messages in edge cases (e.g., two consecutive tool results from different rounds, compaction summary injection).
**Goal**: Before sending to API, merge consecutive user-role messages into one.
- Anthropic's API returns 400 on back-to-back user turns
- OpenAI-compatible providers (especially with Jinja templates like Qwen3) also reject this
- Already partially handled in engine for Qwen3 — should be universal in `adaptMessages()`

**Where**: `src/bun/ai/anthropic.ts` and `src/bun/ai/openai-compatible.ts` → message normalization step.

---

## Notes

- T1 (retry) and T2 (watchdog) are both about **surviving the Anthropic API in production** — these should ship together.
- T3 (prompt caching) + T4 (usage tracking) pair naturally — you need T4 to validate T3 is working (check `cache_read_input_tokens` > 0).
- T5 (`is_error`) is tiny — a one-line change, high correctness value.
- T6 (two-stage JSON) is a rare bug but completely silent when it hits.
- T7 and T8 are defensive hygiene.
