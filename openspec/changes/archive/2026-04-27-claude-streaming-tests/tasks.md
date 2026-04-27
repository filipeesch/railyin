## 1. Update breaking test

- [x] 1.1 In `src/bun/test/claude-events.test.ts`, update the existing `"handles assistant message with text, thinking, and tool_use blocks"` test: change `expect(events).toHaveLength(3)` → `toHaveLength(1)` and `toEqual(["reasoning", "token", "tool_start"])` → `toEqual(["tool_start"])`

## 2. Add stream_event unit tests

- [x] 2.1 Add `describe("stream_event handling")` block to `src/bun/test/claude-events.test.ts` with tests: `text_delta` → `[{ type: "token", content: "hello" }]`, `thinking_delta` → `[{ type: "reasoning", content: "..." }]`, `input_json_delta` → `[]`, non-delta event type (`content_block_start`) → `[]`, unknown delta type → `[]`

## 3. Add assistant dedup unit tests

- [x] 3.1 Add `describe("assistant dedup")` block to `src/bun/test/claude-events.test.ts` with tests: `assistant` with text-only → `[]`, `assistant` with thinking-only → `[]`, `assistant` with tool_use-only → `[tool_start]`, `assistant` with text + tool_use → `[tool_start]`

## 4. Add CE-1 integration test

- [x] 4.1 Implement `MockClaudeSdkAdapter` (test-local class, ~30 lines) that accepts a pre-canned array of SDK messages and yields them via `run()` as an `AsyncGenerator<EngineEvent>` — note: it must yield `EngineEvent`s produced by calling `translateClaudeMessage` on each SDK message, or alternatively the adapter should yield SDK-shaped objects and rely on `ClaudeEngine` to translate them (match the `ClaudeSdkAdapter` interface)
- [x] 4.2 Add `describe("S-14 [claude-streaming]: incremental text_chunks, no double-emit")` to `src/bun/test/stream-pipeline-scenarios.test.ts`: create `ClaudeEngine` with `MockClaudeSdkAdapter`, wire through `makeRuntime`, send a message, wait for `done`, assert IPC contains exactly 2 `text_chunk` events (one per delta) and no third `text_chunk` from the assembled `assistant` block

## 5. Verify

- [x] 5.1 Run `bun test src/bun/test/claude-events.test.ts --timeout 20000` — all tests pass
- [x] 5.2 Run `bun test src/bun/test/stream-pipeline-scenarios.test.ts --timeout 20000` — S-14 passes, no regressions in S-1 to S-13
- [x] 5.3 Run full backend suite `bun test src/bun/test --timeout 20000` — no regressions
