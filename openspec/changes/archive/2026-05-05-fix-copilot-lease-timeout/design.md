## Context

The Copilot engine uses a `LeaseRegistry` to evict idle CLI processes after 10 minutes of inactivity. Three bugs compound to break active chat sessions:

1. **Bug A** — The `onExpire` callback in `session.ts` calls `evictPoolEntry()` unconditionally, even when `PoolEntry.activeSessions > 0` (i.e. a stream is in progress). The `activeSessions` counter is already maintained correctly — it is just never checked at eviction time.

2. **Bug B** — `translateCopilotStream`'s watchdog skips calling `touchLease` when `toolsInFlight > 0`. A tool that runs longer than 10 minutes (e.g. a slow test suite) silently starves the lease, triggering eviction in the middle of a tool call.

3. **Bug C** — When eviction kills the CLI mid-stream, the resulting socket error (`"This socket has been ended by the other party"`) falls through the `catch` block in `engine.ts` (which only soft-handles `"cancelled"` and `"aborted while waiting for input"`), yields a fatal error event, and `stream-processor.ts` sets `execution_state = 'failed'`. The task lands in `failed` instead of `waiting_user`.

The fix touches three files (`session.ts`, `events.ts`, `engine.ts`) and includes a DI cleanup that makes `DefaultCopilotSdkAdapter` testable in isolation.

## Goals / Non-Goals

**Goals:**

- Prevent eviction while a session is actively streaming (`activeSessions > 0`)
- Keep the lease warm during long tool executions via a watchdog heartbeat
- Ensure eviction-triggered stream termination results in `cancelled`/`waiting_user`, not `failed`
- Make `DefaultCopilotSdkAdapter` accept an injected `LeaseRegistry` for testability

**Non-Goals:**

- Changing lease timeout duration or policy
- Modifying `LeaseRegistry` itself (the bug is in the callback passed to it)
- Touching `stream-processor.ts` or the orchestrator (the fix is upstream of those)
- Addressing Claude engine — Claude uses a different adapter; same pattern, separate ticket

## Decisions

### Decision 1: Prevent eviction via `activeSessions` guard (Bug A)

In the `onExpire` callback, check `entry.activeSessions > 0`. If true, call `_leaseRegistry.touch(leaseKey, "running")` and return early — the lease timer resets and eviction is deferred.

**Alternatives considered:**
- *Track a separate "streaming" flag* — redundant with `activeSessions`, which already exists and is correctly maintained.
- *Disable the timer entirely while streaming* — would require pausing/resuming the `LeaseRegistry` timer, which is a bigger API change with no additional benefit.

### Decision 2: `onHeartbeat` callback in `translateCopilotStream` (Bug B)

Add `onHeartbeat?: () => void` as the last parameter of `translateCopilotStream`. It is called unconditionally on every watchdog timer fire, before the `toolsInFlight` guard. The engine passes `() => sdkAdapter.touchLease(sdkSessionId, "running")`.

**Alternatives considered:**
- *Have the watchdog touch the lease directly* — `translateCopilotStream` has no access to the adapter; keeping it pure and callback-driven is cleaner.
- *Only heartbeat when tools are in flight* — misses the case where a slow tool call itself is the cause; unconditional is simpler and correct.

### Decision 3: `onBeforeEvict` async hook (Bug C)

Add `onBeforeEvict(sessionId: string, cb: () => Promise<void>): () => void` to the `CopilotSdkAdapter` interface. The implementation maintains a `Map<string, Set<() => Promise<void>>>` of callbacks per session. Before calling `evictPoolEntry`, the adapter awaits `Promise.all([...callbacks].map(cb => cb()))`.

The engine registers a callback during `_run()` that:
1. Aborts an `evictionController: AbortController` (distinct from `params.signal` and `interviewAbortController`)
2. Awaits `sdkAdapter.abortSession(session!)`

The `evictionController.signal` is wired into `combinedController` so the stream loop exits cleanly. In the `catch` block, `evictionController.signal.aborted` is added to the soft-abort conditions, mirroring `params.signal?.aborted`.

**Alternatives considered:**
- *Detect the socket error message string* — fragile; the error message is SDK-internal and may change.
- *Add a flag to `stream-processor.ts`* — downstream; requires more coordination and doesn't fix the root cause.
- *Synchronous `onBeforeEvict`* — async is required because `abortSession()` is async; eviction must wait for the abort to complete before killing the process.

### Decision 4: Inject `LeaseRegistry` into `DefaultCopilotSdkAdapter` (Cleanup)

Move `_taskCliPool`, `_leaseRegistry`, and `_statusListeners` from module-level singletons to instance variables. Convert the module-level functions `evictPoolEntry` and `getOrCreatePoolEntry` to private methods.

The factory `createDefaultCopilotSdkAdapter()` accepts an optional `LeaseRegistry` parameter (defaults to a fresh instance with `POOL_IDLE_TIMEOUT_MS`). The `_sharedClientPromise` singleton stays at module level since it is intentionally shared across adapter instances for `listModels()`.

**Alternatives considered:**
- *Keep singletons, add reset helpers for tests* — pattern already causes pain in `copilot-rpc-scenarios.test.ts`; true DI is cleaner.
- *Full constructor injection for every dep* — `_sharedClientPromise` is a module-global by design (shared CLI process); no benefit in injecting it.

## Risks / Trade-offs

- **`onBeforeEvict` blocks eviction** — if an engine callback hangs, eviction stalls. Mitigation: the adapter should time-box the `Promise.all` call (e.g. 5s deadline) and log a warning before proceeding with eviction anyway.
- **`activeSessions` guard defers eviction indefinitely** — a leak if `disconnect()` is never called. Mitigation: existing `finally` in `engine.ts` always calls `disconnectSession`; `activeSessions` is already decremented in `DefaultCopilotSdkSession.disconnect()`.
- **DI refactor changes module initialisation order** — singleton teardown in tests must now go through the adapter instance. Mitigation: existing test helpers (`resetLeaseRegistry`, `resetCliPool`) become no-ops on the module and can be removed in favour of creating fresh adapter instances per test.

## Migration Plan

No DB changes, no API changes. Deployment is a drop-in code change. Existing session data on disk is unaffected.

Rollback: revert the three source files; no migrations needed.
