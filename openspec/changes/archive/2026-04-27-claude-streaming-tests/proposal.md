## Why

The `fix-claude-streaming` change introduces new behavior in `translateClaudeMessage` (`stream_event` handling and `assistant` dedup) with zero unit test coverage for those paths. An existing test will break when the fix lands, and there is no integration-level proof that the full pipeline (`MockClaudeSdkAdapter` → `ClaudeEngine` → `StreamProcessor`) produces incremental events without double-emit. Test coverage must exist before the fix ships.

## What Changes

- **Add** `stream_event` test group to `src/bun/test/claude-events.test.ts` — covers `text_delta` → `token`, `thinking_delta` → `reasoning`, ignored delta types (`input_json_delta`, unknown), empty events
- **Add** dedup test group to `src/bun/test/claude-events.test.ts` — covers `assistant` text-only (no output), `assistant` thinking-only (no output), `assistant` with text + tool_use (only `tool_start`)
- **Update** existing `"handles assistant message with text, thinking, and tool_use blocks"` test: expected events change from `["reasoning", "token", "tool_start"]` → `["tool_start"]` (this is a pre-existing test that breaks when the dedup fix lands)
- **Add** integration test `CE-1` to `src/bun/test/stream-pipeline-scenarios.test.ts` using `makeRuntime(engine)` with a `MockClaudeSdkAdapter` that emits `stream_event` deltas followed by an assembled `assistant` — asserts incremental `text_chunk` events and no double-emit

## Capabilities

### New Capabilities

- `claude-streaming-test-coverage`: Unit and integration test coverage for incremental Claude streaming — `stream_event` translation, `assistant` dedup, and end-to-end delta pipeline

### Modified Capabilities

- `claude-engine`: Existing `translateClaudeMessage` mixed-content test expectation changes from 3 events to 1 due to dedup behavior

## Impact

- `src/bun/test/claude-events.test.ts` — ~14 new tests added, 1 existing test updated
- `src/bun/test/stream-pipeline-scenarios.test.ts` — 1 new integration scenario added (CE-1) with a `MockClaudeSdkAdapter` helper class
- No production code changes — this change is test-only
- Depends on `fix-claude-streaming` landing first (the updated test will fail on `main` until the fix is applied)
