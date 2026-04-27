## Context

`src/bun/engine/claude/events.ts` exposes `translateClaudeMessage()` — the core translation function that maps Claude Agent SDK messages to `EngineEvent`s. It has zero unit test coverage for `stream_event` messages and dedup behavior. The `fix-claude-streaming` change adds those two paths; without tests they are unverifiable.

An existing test (`"handles assistant message with text, thinking, and tool_use blocks"`) currently asserts `["reasoning", "token", "tool_start"]`. After the dedup fix, `text` and `thinking` blocks are skipped in the `assistant` handler, making the expected output `["tool_start"]`. This test will fail the moment the fix lands unless it is proactively updated.

At the integration level, the `stream-pipeline-scenarios.test.ts` infrastructure (`makeRuntime` / `BackendRpcRuntime` / `ScriptedEngine`) already handles the full orchestration path. However, `ScriptedEngine` emits pre-translated `EngineEvent`s — it cannot represent raw SDK messages. Testing the `stream_event` → `EngineEvent` → IPC path end-to-end requires a `MockClaudeSdkAdapter` that yields actual SDK message shapes.

## Goals / Non-Goals

**Goals:**
- Full unit coverage of new `stream_event` case in `translateClaudeMessage` (text/thinking/ignored types)
- Full unit coverage of `assistant` dedup behavior (text-only → no events, thinking-only → no events, mixed with tool → only `tool_start`)
- Update the one breaking test before the fix lands so it serves as a regression guard
- CE-1 integration test: proves no double-emit through the full `ClaudeEngine` → `StreamProcessor` pipeline

**Non-Goals:**
- Playwright / UI E2E tests — existing `timeline-pipeline.spec.ts` (T-31, T-46, T-53) already cover incremental rendering end-to-end
- Testing `input_json_delta` rendering — not in scope for `fix-claude-streaming`
- Load or performance tests for streaming throughput

## Decisions

### Decision 1: Unit tests go in the existing `claude-events.test.ts`

`src/bun/test/claude-events.test.ts` already exists with 340 lines of tool-event coverage. Two new `describe` blocks are added:
1. `stream_event handling` — 10 tests covering each delta type
2. `assistant dedup` — 4 tests (text-only, thinking-only, text+tool_use, thinking+tool_use)

The existing `"mixed message content"` block gets a single updated test expectation.

**Alternative considered**: A new `claude-streaming.test.ts` file. Rejected — `translateClaudeMessage` is a single function; splitting its tests across files adds navigation overhead without benefit.

---

### Decision 2: CE-1 integration test uses `ClaudeEngine` + `MockClaudeSdkAdapter` wired through `makeRuntime`

`ClaudeEngine` already accepts a `ClaudeSdkAdapter` via its constructor. `createBackendRpcRuntime` accepts any `ExecutionEngine`. The integration test does:

```
MockClaudeSdkAdapter           ← yields SDK messages (stream_event × N, then assistant)
  → ClaudeEngine.execute()     ← calls translateClaudeMessage per message
    → StreamProcessor.consume() ← relays EngineEvents to IPC callbacks
      → BackendRpcRuntime.getIpcEvents()  ← assertions
```

`MockClaudeSdkAdapter` is ~30 lines, test-local, and yields pre-canned sequences. The assertion: IPC contains exactly N `text_chunk` events (one per delta), no extra `text_chunk` from the `assistant` block, and a `done`.

CE-1 lives in `stream-pipeline-scenarios.test.ts` under a new `S-14` scenario block, consistent with existing naming.

**Alternative considered**: Test `ClaudeEngine` in isolation by collecting `EngineEvent`s directly from `execute()`. Rejected — this only covers the translation layer, not the dedup effect on downstream IPC delivery. CE-1 must prove no double-emit reaches the IPC layer.

---

### Decision 3: The broken test update is a dedicated task, not bundled with new tests

The test `"handles assistant message with text, thinking, and tool_use blocks"` is conceptually "existing regression guard updated for new behavior." Calling it out as its own task (4.2 in `fix-claude-streaming`) makes the contract explicit: the test must be updated *and* pass before the fix is considered complete.

## Risks / Trade-offs

- **`MockClaudeSdkAdapter` interface drift**: If `ClaudeSdkAdapter` interface changes, the mock breaks. → Mitigation: the interface is stable (adapter.ts, unchanged for months); the mock is test-local and easy to update.
- **CE-1 is order-dependent on `fix-claude-streaming`**: CE-1 will fail on `main` until `includePartialMessages: true` and the `stream_event` case are both in place. → Mitigation: this change is explicitly scoped to ship together with or after `fix-claude-streaming`.
- **`stream-pipeline-scenarios.test.ts` is already 611 lines**: Adding CE-1 grows it further. → Accepted trade-off; the file is structurally organized by scenario number and easy to navigate.
