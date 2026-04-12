## Context

The chat timeline UI tests (`chat-timeline-pipeline.test.ts`) inject synthetic stream events via HTTP POST to `/queue-stream-events`, which fires Electrobun IPC to the webview. The IPC is fire-and-forget — the HTTP response returns before the Vue store processes the event. Tests currently bridge this gap with `sleep()` delays, causing flakiness.

The Pinia task store already increments a global `streamVersion` counter (line 263 of `task.ts`) on every `onStreamEvent` call. This counter is the natural synchronization point: tests can read it before injection, then poll until it reaches the expected value after injection.

## Goals / Non-Goals

**Goals:**
- Eliminate all `sleep()`-based synchronization between event injection and assertion in stream pipeline tests
- Provide `injectEvents()` that returns only after the store has processed all injected events
- Provide `resetStream()` that confirms state cleanup via version watermark
- Unify Suite T and Suite S `beforeEach` reset logic into one path
- Add 7 new test scenarios covering reasoning streaming, nested tool calls, and tree structure correctness

**Non-Goals:**
- Changing production code (store, components, orchestrator) — bugs found by tests will be fixed in a separate change
- Removing `queueStreamEvents` — keep for backward compat, mark deprecated
- Testing the legacy (non-pipeline) streaming path
- Performance optimization of tests (faster is a side effect, not a goal)

## Decisions

### 1. Use `streamVersion` as the watermark (not per-task state)

`streamVersion` is a global counter incremented on every event. An alternative was per-task version tracking, but:
- Global is simpler — one counter, one poll
- Tests run serially against one task — no cross-task interference
- The counter already exists, no store changes needed

### 2. Poll via `webEval` at 50ms intervals

Read `streamVersion` from Pinia via `webEval` in a tight loop (50ms). Alternatives:
- **IPC callback**: Would require production code changes (adding a test hook to the store)
- **MutationObserver**: DOM-level, doesn't help for store-only assertions
- **200ms polling** (current `waitFor`): Too coarse — 50ms is safe since webEval is fast (~5ms round-trip)

### 3. Keep DOM assertions via `waitFor` with reduced timeouts

After `injectEvents` returns, the store is guaranteed processed but Vue needs one tick for DOM. Rather than adding a Vue flush primitive, keep `waitFor(selector, 500)` — it's explicit about what we're waiting for, and 500ms is generous for a single nextTick.

### 4. `injectEvents` wraps `queueStreamEvents` + watermark

```
injectEvents(events) {
  v0 = getStreamVersion()
  queueStreamEvents(events)           // HTTP POST, no internal sleep
  waitForStreamVersion(v0 + events.length)
  return v0 + events.length
}
```

The `sleep(100)` inside `queueStreamEvents` will be removed. `injectEvents` handles synchronization deterministically.

### 5. Unified `resetStream` replaces two divergent reset patterns

Suite T uses `pinia._s.get('task').streamStates.delete()` + `new Map()`.
Suite S uses `window.__pinia?.state?.value?.task?.streamStates?.delete()`.

`resetStream` unifies:
1. Send synthetic `done` event (closes any open stream)
2. Delete task from `streamStates` Map via webEval (single Pinia access path: `pinia._s.get('task')`)
3. Trigger reactivity via `new Map()` assignment
4. Wait for version watermark to confirm

### 6. Store-only vs DOM assertions

| Assertion type  | Method                          | Wait needed after injectEvents |
|----------------|---------------------------------|-------------------------------|
| Store state    | `getStreamState(taskId)`        | None                          |
| DOM exists     | `waitFor(selector, 500)`        | Short poll (≤500ms)           |
| DOM gone       | `webEval(check)` after short wait | ~100ms for Vue tick          |
| DOM content    | `webEval(read text)`            | None (store already synced)   |

## Risks / Trade-offs

**[Risk] `streamVersion` increment is 1:1 with events** → If the store ever batches events or skips the counter, `waitForStreamVersion(v0 + N)` would hang. **Mitigation**: Timeout (4s default) with descriptive error showing actual vs expected version.

**[Risk] webEval polling adds ~5ms per iteration** → At 50ms intervals with typically 1-3 polls needed, overhead is ~50-150ms per `injectEvents` call. **Mitigation**: Acceptable — much faster than current `sleep(200-500)` delays.

**[Risk] Retrofitting 18 existing tests** → Mechanical but touches every test body. **Mitigation**: Pattern is simple find-replace; run full suite after each batch to catch regressions.
