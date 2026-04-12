## 1. Bridge Watermark Primitives

- [x] 1.1 Add `getStreamVersion()` to `bridge.ts` — reads `pinia._s.get('task').streamVersion` via webEval, returns number
- [x] 1.2 Add `waitForStreamVersion(minVersion, timeoutMs=4000)` to `bridge.ts` — polls at 50ms intervals, throws with actual/expected on timeout
- [x] 1.3 Add `injectEvents(events)` to `bridge.ts` — calls `getStreamVersion()`, then `queueStreamEvents()` (without sleep), then `waitForStreamVersion(v0 + events.length)`, returns new version
- [x] 1.4 Remove `sleep(100)` from inside `queueStreamEvents()` — keep function signature, mark with `@deprecated` JSDoc pointing to `injectEvents`
- [x] 1.5 Add `resetStream(taskId, executionId)` to `bridge.ts` — sends done event via `queueStreamEvents`, deletes from `streamStates` Map via webEval (using `pinia._s.get('task')` path), triggers reactivity with `new Map()`, waits for version watermark
- [x] 1.6 Export `getStreamVersion`, `waitForStreamVersion`, `injectEvents`, `resetStream` from `bridge.ts`
- [x] 1.7 Verify primitives work: write a minimal smoke test or manually confirm `injectEvents` returns only after store processes events

## 2. Retrofit Existing Tests (T-28 through T-45)

- [x] 2.1 Replace Suite T `resetStreamState()` with `resetStream()` in `beforeEach`
- [x] 2.2 Replace Suite S `beforeEach` cleanup with `resetStream()` (unify with Suite T)
- [x] 2.3 Retrofit T-28 through T-34: replace `queueStreamEvents` + `sleep` with `injectEvents`, reduce `waitFor` timeouts to 500ms
- [x] 2.4 Retrofit T-35 through T-40: same pattern — `injectEvents` + short `waitFor`
- [x] 2.5 Retrofit T-41 through T-45 (Suite S): replace `queueStreamEvents` + `sleep` with `injectEvents`, use `evt()` helper unchanged
- [x] 2.6 Run full test suite (T-28..T-45) — all 18 must pass with zero sleeps in test bodies

## 3. New Test Scenarios (T-46 through T-52)

- [x] 3.1 T-46: Reasoning chunks stream incrementally — inject 3 `reasoning_chunk` events one-by-one via separate `injectEvents` calls, assert `.rb__content` text grows after each, assert `.rb__content--streaming` present throughout
- [x] 3.2 T-47: Reasoning chunks batch-accumulate — inject 3 `reasoning_chunk` events in one `injectEvents` call, assert exactly 1 `reasoning_chunk` block in store, content equals concatenation
- [x] 3.3 T-48: Reasoning bubble auto-opens while streaming, auto-closes after done — inject `reasoning_chunk`, assert `.rb__body` visible; inject persisted `reasoning` + `done`, assert `.rb__body` not visible
- [x] 3.4 T-49: Nested tool call under parent tool — inject parent `tool_call` at root, then child `tool_call` with `parentBlockId=parent`, assert child in parent's `children[]` and NOT in `roots[]`
- [x] 3.5 T-50: Reasoning chunk inside tool context — inject `tool_call`, then `reasoning_chunk` with `parentBlockId=tool`, assert reasoning in tool's `children[]`, assert `.tcg__children .rb` in DOM
- [x] 3.6 T-51: Full orchestrator nesting flow — inject sequence: `reasoning_chunk` → `reasoning` (persisted) → `tool_call` → `reasoning_chunk(parent=tool)` → `reasoning(parent=tool)` → `tool_result` → `assistant`, assert roots order [reasoning, tool_call, assistant], tool has nested reasoning child, no live blocks after done
- [x] 3.7 T-52: Persisted reasoning replaces live chunks — inject 3 `reasoning_chunk` building "abc", then inject persisted `reasoning` with content "abc", assert 0 `reasoning_chunk` blocks and 1 `reasoning` block with content "abc"
- [x] 3.8 Run full suite (T-28..T-52) — all 25 tests pass

## 4. Cleanup

- [x] 4.1 Remove old `resetStreamState` function from test file (dead code after `resetStream` replaces it)
- [x] 4.2 Update test file header comment with new run command and scenario list (T-46..T-52)
- [x] 4.3 Final run: backend tests (`bun test src/bun/test --timeout 20000`) + UI tests (all 25) pass
