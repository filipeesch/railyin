## 1. DI Cleanup — session.ts refactor

- [x] 1.1 Move `_taskCliPool` from module-level `Map` to instance variable `this.taskCliPool` on `DefaultCopilotSdkAdapter`
- [x] 1.2 Move `_statusListeners` from module-level `Set` to instance variable `this.statusListeners` on `DefaultCopilotSdkAdapter`
- [x] 1.3 Convert `evictPoolEntry(leaseKey)` and `getOrCreatePoolEntry(sessionId)` from module-level functions to private methods on `DefaultCopilotSdkAdapter`
- [x] 1.4 Update `createDefaultCopilotSdkAdapter()` to accept an optional injected `LeaseRegistry`; default to `new LeaseRegistry("copilot", POOL_IDLE_TIMEOUT_MS, ...)` when not provided
- [x] 1.5 Wire the injected (or default) `LeaseRegistry` as `this.leaseRegistry`; replace all `_leaseRegistry` references in adapter methods
- [x] 1.6 Export `DefaultCopilotSdkAdapter` class from `session.ts` so it can be instantiated directly in unit tests

## 2. Bug A — Eviction guard for active sessions

- [x] 2.1 In the `onExpire` callback (passed to `LeaseRegistry` constructor), read `entry.activeSessions` from `this.taskCliPool`
- [x] 2.2 If `activeSessions > 0`, call `this.leaseRegistry.touch(leaseKey, "running")` and return early without evicting
- [x] 2.3 Otherwise proceed with `await this.evictPoolEntry(leaseKey)` as before

## 3. Bug B — Watchdog heartbeat in translateCopilotStream

- [x] 3.1 Replace the hardcoded `IDLE_TIMEOUT_MS = 120_000` and `MAX_SILENCE_COUNT = 3` constants in `events.ts` with optional flat parameters `idleTimeoutMs = 120_000` and `maxSilenceCount = 3` on `translateCopilotStream` — keeping existing behaviour unchanged
- [x] 3.2 Add `onHeartbeat?: () => void` as a new last parameter to `translateCopilotStream` in `events.ts`
- [x] 3.3 In the watchdog timer callback, call `onHeartbeat?.()` unconditionally before the `toolsInFlight > 0` early-return guard
- [x] 3.4 In `engine.ts`, pass `onHeartbeat: () => this.sdkAdapter.touchLease(sdkSessionId, "running")` when calling `translateCopilotStream`

## 4. Bug C — Pre-eviction abort hook

- [x] 4.1 Add `onBeforeEvict(sessionId: string, cb: () => Promise<void>): () => void` to the `CopilotSdkAdapter` interface in `session.ts`
- [x] 4.2 Implement `onBeforeEvict` on `DefaultCopilotSdkAdapter`: maintain `this.beforeEvictListeners: Map<string, Set<() => Promise<void>>>` and return an unsubscribe function
- [x] 4.3 In `evictPoolEntry`, before stopping the CLI process, call `await Promise.all([...callbacks].map(cb => cb()))` with a 5-second deadline; log a warning if the deadline is exceeded
- [x] 4.4 In `engine.ts` `_run()`, create `evictionController = new AbortController()` and register `sdkAdapter.onBeforeEvict(sdkSessionId, async () => { evictionController.abort(); await sdkAdapter.abortSession(session!).catch(() => {}); })` — store the returned unsubscribe as `unsubEvict`
- [x] 4.5 Wire `evictionController.signal` into `combinedController`: add `evictionController.signal.addEventListener("abort", () => combinedController.abort(), { once: true })` inside the `while` loop
- [x] 4.6 In the `catch` block of `_run()`, add `evictionController.signal.aborted` to the soft-abort condition (alongside `params.signal?.aborted`)
- [x] 4.7 In the `finally` block of `_run()`, call `unsubEvict()` to clean up the listener

## 5. Tests

_Tests are covered in the companion change `fix-copilot-lease-timeout-tests`._
