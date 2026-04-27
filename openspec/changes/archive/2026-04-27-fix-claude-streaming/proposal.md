## Why

The Claude engine never enabled incremental streaming: without `includePartialMessages: true` in the SDK query options, the `@anthropic-ai/claude-agent-sdk` absorbs all Anthropic API `content_block_delta` events internally and emits a single complete `assistant` message only after the model finishes its entire response. As a result, text and reasoning blocks appear all at once in the UI instead of streaming word-by-word — exactly how Copilot already works via its `assistant.message_delta` events.

## What Changes

- Add `includePartialMessages: true` to the `sdk.query()` options in the Claude adapter so the SDK emits incremental `stream_event` messages during generation.
- Add a `stream_event` case to `translateClaudeMessage` that maps `text_delta` → `{ type: "token" }` and `thinking_delta` → `{ type: "reasoning" }`.
- Update the `assistant` case in `translateClaudeMessage` to skip `text` and `thinking` blocks (already delivered via deltas) while continuing to process `tool_use` blocks (which only arrive fully assembled).
- Add unit tests for the `translateClaudeMessage` function covering the new `stream_event` case, the dedup behaviour in the `assistant` case, and the existing `tool_use` handling.

## Capabilities

### New Capabilities

- `claude-streaming`: Incremental token and reasoning streaming for the Claude engine, mirroring how the Copilot engine already delivers `assistant.message_delta` events.

### Modified Capabilities

- `claude-engine`: The requirement that Claude delivers text content incrementally (not as a single batch) is a new spec-level behaviour change.

## Impact

- `src/bun/engine/claude/adapter.ts` — one-line option addition to `sdk.query()`.
- `src/bun/engine/claude/events.ts` — new `stream_event` case; `assistant` case updated to skip text/thinking blocks.
- `src/bun/test/claude-adapter.test.ts` (or new `claude-events.test.ts`) — new unit tests for `translateClaudeMessage`.
- No API contract changes; no database changes; no frontend changes required (orchestrator already handles `token` and `reasoning` events from the Claude engine path).
