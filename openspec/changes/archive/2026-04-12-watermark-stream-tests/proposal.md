## Why

UI tests for the chat timeline stream pipeline use `sleep()` delays between event injection and assertions, causing flaky results when timing varies. Additionally, critical scenarios are untested: reasoning chunks don't visibly stream (content appears only when complete), and tool calls nested under parent tool contexts render at root level instead of inside their parent's collapsible body. We need deterministic test primitives and targeted test scenarios to catch these bugs reliably.

## What Changes

- **New bridge primitives**: Add `getStreamVersion()`, `waitForStreamVersion()`, `injectEvents()`, and `resetStream()` to `bridge.ts` — leveraging the store's `streamVersion` counter as a causal watermark between event injection and assertion
- **Remove sleep-based synchronization**: Replace all `queueStreamEvents()` + `sleep()` patterns in existing tests (T-28..T-45) with `injectEvents()` which waits for the store to process events before returning
- **Unify test reset**: Consolidate Suite T and Suite S `beforeEach` to use a single `resetStream()` that confirms reset via version watermark
- **Add 7 new test scenarios** (T-46..T-52) covering: incremental reasoning streaming, batch chunk accumulation, reasoning bubble auto-open/close, nested tool calls, nested reasoning inside tool context, full orchestrator nesting flow, and persisted reasoning replacing live chunks
- **Deprecate `queueStreamEvents`**: Keep for backward compat but mark deprecated in favor of `injectEvents`

## Capabilities

### New Capabilities
- `stream-test-watermark`: Bridge primitives (`getStreamVersion`, `waitForStreamVersion`, `injectEvents`, `resetStream`) that use the Pinia `streamVersion` counter as a deterministic synchronization mechanism between test event injection and UI assertions

### Modified Capabilities
- `unified-ai-stream`: Adding test coverage for streaming reasoning chunks, nested tool rendering, and tree structure correctness — no spec-level behavior changes, only test gaps being filled

## Impact

- **Files modified**: `src/ui-tests/bridge.ts`, `src/ui-tests/chat-timeline-pipeline.test.ts`
- **No production code changes** — this is purely test infrastructure and new test scenarios
- **Backward compatible**: `queueStreamEvents` remains available, deprecated in favor of `injectEvents`
- **Test count**: 18 existing → 25 total (7 new scenarios)
