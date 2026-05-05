## 1. Testability Refactorings (production code, minimal surface)

- [x] 1.1 Export `DefaultCopilotSdkAdapter` class from `session.ts`
- [x] 1.2 Replace `IDLE_TIMEOUT_MS = 120_000` and `MAX_SILENCE_COUNT = 3` module-level constants in `events.ts` with optional flat params `idleTimeoutMs = 120_000` and `maxSilenceCount = 3` on `translateCopilotStream` — all existing call sites pass no value (defaults unchanged)

## 2. Mock Updates

- [x] 2.1 Add `onBeforeEvict(sessionId: string, cb: () => Promise<void>): () => void` to `MockCopilotSdkAdapter` — store callbacks in `Map<string, Set<...>>`, return unsubscribe
- [x] 2.2 Add `triggerBeforeEvict(sessionId: string): Promise<void>` test helper to `MockCopilotSdkAdapter` — fires all stored callbacks in parallel
- [x] 2.3 Add `touchCalls: Array<{ sessionId: string; state: string }>` to `MockCopilotSdkAdapter` trace so tests can assert `touchLease("running")` calls

## 3. Unit Tests — copilot-sdk-adapter.test.ts (new file)

- [x] 3.1 A1: eviction suppressed — `activeSessions > 0` causes `touch("running")`, no eviction (inject fast `LeaseRegistry` 20ms)
- [x] 3.2 A2: eviction proceeds — `activeSessions = 0` causes `evictPoolEntry` to be called
- [x] 3.3 A3: `onBeforeEvict` callbacks awaited before eviction (timestamp ordering assertion)
- [x] 3.4 A4: 5-second deadline enforced — slow callback does not block eviction indefinitely
- [x] 3.5 A5: unsubscribe removes the callback before eviction fires
- [x] 3.6 A6: `activeSessions` increments on `createSession` (regression guard)
- [x] 3.7 A7: `activeSessions` decrements on `disconnect` (regression guard)

## 4. Unit Tests — copilot-events.test.ts (extend existing)

- [x] 4.1 B1: `onHeartbeat` fires on every watchdog cycle when no tools are in flight (`idleTimeoutMs: 10`, wait 25ms, assert ≥ 2 calls)
- [x] 4.2 B2: `onHeartbeat` fires even when `toolsInFlight > 0` (toolStart → waitForAbort, assert ≥ 1 call and stream still alive)

## 5. Integration Tests — copilot-rpc-scenarios.test.ts (extend existing)

- [x] 5.1 C1: execution ends as `cancelled` not `failed` when `triggerBeforeEvict` fires mid-stream (`waitForAbort` session script, assert `waitForExecutionStatus(id, "cancelled")`)
- [x] 5.2 C2: smoke — `adapter.trace.touchCalls` contains at least one `"running"` entry after a tool starts executing (Bug B wiring proof)
- [x] 5.3 Update existing tests that rely on module-level singletons to use injected adapter instances after the DI refactor lands
