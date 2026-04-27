## Context

The `@anthropic-ai/claude-agent-sdk` (v0.2.98) exposes an `AsyncGenerator<SDKMessage>` from `sdk.query()`. By default (`includePartialMessages: false`), the SDK internally consumes all Anthropic SSE events (`content_block_delta`, `text_delta`, `thinking_delta`) and only yields one fully-assembled `{ type: "assistant" }` message per turn. This means the Claude engine's `translateClaudeMessage` only ever sees complete blocks — no incremental tokens reach the orchestrator's `onToken()` or the frontend's `text_chunk` WebSocket events during generation.

The Copilot engine does not have this problem: the Copilot SDK emits discrete `assistant.message_delta` events per chunk, and `translateCopilotStream` already maps them to `{ type: "token" }` events incrementally.

## Goals / Non-Goals

**Goals:**
- Deliver text tokens to the frontend incrementally as the model generates them (same UX as Copilot).
- Deliver reasoning/thinking tokens incrementally.
- No regression in tool_use handling (tool names, arguments, call IDs).
- Add unit test coverage for `translateClaudeMessage` (currently zero).

**Non-Goals:**
- Streaming incremental tool input JSON (`input_json_delta`) — not renderable usefully and not in scope.
- Changing the orchestrator, frontend, or RPC types — the existing `token`/`reasoning` event paths already work.
- Updating the cached `cli.js` — the option has been available since at least v0.2.98.

## Decisions

### Decision 1: Enable `includePartialMessages: true` unconditionally

**Choice**: Add `includePartialMessages: true` to the `sdk.query()` options object in `DefaultClaudeSdkAdapter._run()`.

**Rationale**: The SDK will now emit `{ type: "stream_event", event: BetaRawMessageStreamEvent }` messages during generation alongside the final `assistant` message. This is the canonical SDK mechanism — no custom parsing of the Anthropic SSE protocol needed.

**Alternative considered**: Parse `content_block_delta` events from the raw `onRawMessage` callback. Rejected: that callback receives already-assembled data, not raw SSE.

---

### Decision 2: Handle `stream_event` in `translateClaudeMessage`, skip text/thinking in `assistant`

**The double-emit problem**: With `includePartialMessages: true`, the SDK emits:
1. Many `stream_event` messages (one per delta chunk) — containing the text/thinking incrementally.
2. One final `assistant` message — containing the fully assembled text/thinking blocks.

If we process both, the content is emitted twice.

**Choice**: 
- Add a `stream_event` case that maps `text_delta` → `{ type: "token" }` and `thinking_delta` → `{ type: "reasoning" }`.
- In the `assistant` case, **skip `text` and `thinking` blocks entirely** — they were already delivered via `stream_event` deltas.
- The `assistant` case continues to process `tool_use` blocks as before (tool calls only arrive fully assembled; `input_json_delta` is not a useful streaming primitive).

**Alternative considered**: Thread a `receivedStreamingText: boolean` flag through `translateClaudeMessage` (mirroring Copilot's `receivedTokenDelta` pattern) so the `assistant` handler conditionally skips. Rejected as unnecessary complexity: since we commit to always passing `includePartialMessages: true`, the flag is always true. Unconditional skip is simpler and has no edge case.

**Alternative considered**: Process `assistant` text as before and suppress `stream_event`. Rejected: defeats the purpose.

---

### Decision 3: New test file `claude-events.test.ts` alongside the adapter test

`claude-adapter.test.ts` currently tests only permission helpers. The new streaming cases test `translateClaudeMessage` — a different concern. A separate `claude-events.test.ts` keeps the files focused and avoids cluttering the adapter test with unrelated assertions.

## Risks / Trade-offs

- **SDK behaviour change in future versions**: If a future SDK version changes how `includePartialMessages` works (e.g., stops emitting the final `assistant` message), the `assistant` case in `translateClaudeMessage` becomes a no-op for text/thinking rather than a bug. Low risk, easy to detect.
- **`tool_use` blocks in `assistant` still required**: The `assistant` case must NOT be removed entirely — it still handles `tool_use` blocks (and stores tool metadata for pairing with `tool_result`). The dedup only affects `text`/`thinking`.
- **`input_json_delta` events**: With `includePartialMessages: true`, `stream_event` messages with `input_json_delta` deltas will also arrive. These are fragments of tool input JSON being assembled. The `stream_event` handler must ignore them (only handle `text_delta` and `thinking_delta`).

## Migration Plan

No migration required. The change is entirely within the Claude engine adapter and event translation layer. Existing sessions are unaffected (sessions resume normally). The `cli.js` binary is not changed.

Rollback: revert the `includePartialMessages: true` line and the `stream_event` case in `events.ts`. The engine falls back to batch-mode silently.

## Breaking Test to Update

`src/bun/test/claude-events.test.ts` — `"handles assistant message with text, thinking, and tool_use blocks"` currently expects `["reasoning", "token", "tool_start"]` (3 events). After the dedup fix the `assistant` handler skips text/thinking, so only `["tool_start"]` is emitted. **This test must be updated** (not deleted) — it becomes the regression proof that dedup is working.

## Integration Test Pattern (CE-1)

`ClaudeEngine` already accepts a `ClaudeSdkAdapter` in its constructor. `StreamProcessor` can be instantiated directly with a real DB (as shown in `stream-processor.test.ts`). This means a full integration test is achievable without mocking internals:

1. Implement `MockClaudeSdkAdapter` (test-only, ~30 lines) that yields pre-canned SDK messages (`stream_event` deltas + `assistant` assembled).
2. Wire: `MockClaudeSdkAdapter` → `ClaudeEngine` → `StreamProcessor.consume()` using the `makeRuntime(engine)` helper from `stream-pipeline-scenarios.test.ts`.
3. Assert IPC contains incremental `text_chunk` events but **not** a duplicate from the `assistant` block.

This resolves the previously open DI question — no `DefaultClaudeSdkAdapter` refactor is required for integration-level coverage.
