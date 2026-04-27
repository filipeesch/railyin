## 1. Enable SDK partial messages

- [x] 1.1 Add `includePartialMessages: true` to `sdk.query()` options in `DefaultClaudeSdkAdapter._run()` in `src/bun/engine/claude/adapter.ts`

## 2. Translate stream_event deltas

- [x] 2.1 Add `stream_event` case to `translateClaudeMessage` in `src/bun/engine/claude/events.ts` that maps `text_delta` → `{ type: "token" }` and `thinking_delta` → `{ type: "reasoning" }`, and returns `[]` for all other delta types (e.g. `input_json_delta`)

## 3. Fix assistant message dedup

- [x] 3.1 Update the `assistant` case in `translateClaudeMessage` to skip `text` and `thinking` content blocks, while continuing to process `tool_use` blocks as before

## 4. Unit tests

- [x] 4.1 Add tests to existing `src/bun/test/claude-events.test.ts` for `translateClaudeMessage` covering: `stream_event` with `text_delta`, `stream_event` with `thinking_delta`, `stream_event` with `input_json_delta` (no output), `assistant` with only a `text` block (no output after dedup), `assistant` with a `tool_use` block (produces `tool_start`)
- [x] 4.2 Update the existing `"handles assistant message with text, thinking, and tool_use blocks"` test: after dedup, expected events change from `["reasoning", "token", "tool_start"]` to `["tool_start"]`
- [x] 4.3 Run `bun test src/bun/test/claude-events.test.ts --timeout 20000` and verify all tests pass
- [x] 4.4 Run full backend suite `bun test src/bun/test --timeout 20000` and verify no regressions

## 5. Integration test (CE-1)

- [x] 5.1 Add a `MockClaudeSdkAdapter` (in test scope) that yields raw SDK messages: two `stream_event` text deltas followed by one `assistant` message containing the assembled text block
- [x] 5.2 Wire `MockClaudeSdkAdapter` → `ClaudeEngine` → `StreamProcessor.consume()` (following the pattern in `stream-pipeline-scenarios.test.ts` with `makeRuntime`) and assert: IPC contains exactly two `text_chunk` events, no third `text_chunk` from the `assistant` block, and a final `done`
- [x] 5.3 Run the integration test and confirm it passes

## 6. End-to-end tests

- [x] 6.1 Write and run e2e tests for Claude streaming
