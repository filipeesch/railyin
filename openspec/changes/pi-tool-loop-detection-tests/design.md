## Context

Tests for the `ToolLoopDetector` class, `PiEngine` loop guard wiring, child session guard via `buildDelegateTool`, and `HarnessContext` initialization. All tests use dependency injection (mock sessions, injectable factories) — no real Pi SDK sessions created. Two mock classes require minimal shape extensions to expose `beforeToolCall` on their `agent` object.

**Dependency:** `pi-tool-loop-detection` change must be implemented first.

## Testing Strategy

Three test tiers:

1. **Unit** — pure class tests for `ToolLoopDetector` and `HarnessContext`; no DB, no SDK
2. **Integration** — `PiEngine` tests using `MockBgSession` with in-memory DB (same pattern as `background-compaction.test.ts`)
3. **Mock extension** — `MockChildSession` and `MockBgSession` gain `beforeToolCall` agent slot; existing tests are unaffected

No Playwright tests required — no new UI, API, or push events introduced.

## Mock Refactoring Required

### MockBgSession (`background-compaction.test.ts`)
Add `beforeToolCall: undefined as any` to `readonly agent` shape. Reflects the real `Agent` interface. Existing BC-1–BC-5 tests unaffected — they never set or inspect `beforeToolCall`.

### MockChildSession (`delegate.test.ts`)
Add `beforeToolCall: ((ctx: any, signal?: AbortSignal) => Promise<any>) | undefined` to `readonly agent` shape. Add optional `toolCallSequence: Array<{ name: string; args: Record<string, unknown> }>` constructor parameter — when set, `prompt()` iterates the sequence and calls `this.agent.beforeToolCall?.(ctx)` for each entry before completing. Existing DL-1–DL-14 tests pass no sequence → behaviour unchanged.

## Design Notes

- `ToolLoopDetector.record()` mutates the window synchronously — all unit tests are pure synchronous (no async)
- `beforeToolCall` hook returns `Promise<BeforeToolCallResult | undefined>` — test helpers wrap synchronous detector calls in `async`
- The `args` field in `BeforeToolCallContext` is typed as `unknown` but is `Record<string, unknown>` in practice — tests cast accordingly
- `loop-detection-engine.test.ts` follows the `background-compaction.test.ts` pattern: `makePiEngine(session, config)` + `runExecution(engine, convId)` + `flushAsync()`
