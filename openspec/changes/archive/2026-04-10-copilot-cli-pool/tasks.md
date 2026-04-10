## 1. Per-Task CLI Pool (session.ts)

- [x] 1.1 Add `_taskCliPool: Map<string, { clientPromise: Promise<LoadedCopilotClient>; idleTimer: ReturnType<typeof setTimeout> }>` alongside the existing `_sharedClientPromise`
- [x] 1.2 Implement `getOrCreatePoolEntry(sessionId: string): Promise<LoadedCopilotClient>` — looks up existing entry and resets its timer, or spawns a new CLI and inserts a new entry
- [x] 1.3 Implement `evictPoolEntry(sessionId: string)` — calls `client.stop()` and removes the entry from `_taskCliPool`; no-ops if the entry no longer matches (handles race with timer reset)
- [x] 1.4 Update `DefaultCopilotSdkAdapter.createSession()` to call `getOrCreatePoolEntry(config.sessionId)` instead of `getClient()`
- [x] 1.5 Update `DefaultCopilotSdkAdapter.resumeSession()` to call `getOrCreatePoolEntry(sessionId)` instead of `getClient()`
- [x] 1.6 Remove per-task port file writes from `getOrSpawnCliPort()` / ensure the shared singleton still uses the port file; per-task pool entries manage their own in-memory lifecycle only

## 2. Adapter Interface Extension (session.ts)

- [x] 2.1 Add `pingClient(sessionId: string): Promise<boolean>` to the `CopilotSdkAdapter` interface — returns `true` if CLI is healthy, `false` if dead or timeout
- [x] 2.2 Implement `DefaultCopilotSdkAdapter.pingClient(sessionId)` — looks up the pool entry, races `client.ping()` against a 5s timeout, returns `true`/`false` (never throws)

## 3. Watchdog Enhancement (events.ts)

- [x] 3.1 Add `onWatchdogFire?: () => Promise<boolean>` parameter to `translateCopilotStream()` signature
- [x] 3.2 On watchdog timeout: call `onWatchdogFire()` if provided, else treat as CLI healthy (backward compat)
- [x] 3.3 If `onWatchdogFire()` returns `false` (CLI dead): push fatal error and exit immediately, same as today
- [x] 3.4 If `onWatchdogFire()` returns `true` (CLI alive): increment a local `silenceCount`, reset watchdog timer and continue
- [x] 3.5 If `silenceCount >= 3`: push `{ type: "error", message: "Copilot session unresponsive (no events for 360s, CLI healthy)", fatal: true }` and exit
- [x] 3.6 Reset `silenceCount` to 0 inside the `session.on()` callback when a real SDK session event arrives (alongside the existing `wake()` call)

## 4. Wire `onWatchdogFire` through engine.ts

- [x] 4.1 In `CopilotEngine._run()`, construct the `onWatchdogFire` callback as `() => adapter.pingClient(sessionId)` and pass it to `translateCopilotStream()`

## 5. Verification

- [ ] 5.1 Run two concurrent tasks in a local dev environment and confirm both complete without timeout errors
- [ ] 5.2 Confirm that stopping Railyin with active pool entries doesn't leave orphaned CLI processes (check process list after shutdown)
- [ ] 5.3 Confirm `listModels()` still works (shared singleton is unaffected)
