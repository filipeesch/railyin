## Context

The Copilot engine uses `@github/copilot-sdk` to run agentic sessions. The SDK communicates with a Copilot CLI process over JSON-RPC (TCP or stdio). The CLI is single-threaded and serves requests serially.

**Current state**: A module-level `_clientPromise` singleton in `session.ts` means all concurrent task executions share one CLI process. When tasks run concurrently, the CLI serves one session's `send()` call while the other session is starved of events. The 120s watchdog in `events.ts` fires on the silent session, producing a false "connection timed out" error.

**Confirmed from production logs**: Tasks 32 and 33 both recorded `"Copilot connection timed out (no events for 120s)"` in the `executions` table, caused by this starvation.

## Goals / Non-Goals

**Goals:**
- Each task execution uses its own CLI process — no cross-task interference
- CLI processes are cleaned up automatically when idle to avoid unbounded resource growth
- On CLI crash, fail within seconds (not after 120s silence)
- On genuinely stuck session (CLI alive, session silent), fail after bounded wait

**Non-Goals:**
- No changes to the `CopilotSdkAdapter` interface — `engine.ts` and `resolver.ts` are untouched
- Not per-execution isolation (a task may resume across multiple executions; CLI lifetime follows the session, not a single `execute()` call)
- No watchdog value change — 120s is correct as a per-window duration

## Decisions

### 1. Pool keyed by `sessionId`, not `taskId` or `executionId`

`sessionId` is the natural SDK boundary (`resumeSession()` takes it). In Railyin it is derived as `railyin-task-${taskId}`, so there is a 1:1 mapping with tasks. Keying by `executionId` would spawn a new CLI per `execute()` call, which is wasteful and loses session state continuity between runs.

### 2. Pool structure: `Map<sessionId, { clientPromise, idleTimer }>`

Each entry holds:
- `clientPromise: Promise<LoadedCopilotClient>` — lazy-initialized, resolved once per entry
- `idleTimer: Timer` — reset on every `createSession`/`resumeSession` call for that sessionId

`createSession` and `resumeSession` both call a shared `getOrCreatePoolEntry(sessionId)` that either returns the existing entry (and resets its idle timer) or creates a new one.

**Alternative considered**: A semaphore/queue to reuse one CLI with serialization. Rejected — the SDK docs explicitly say "scale by adding more CLI server instances, not threads."

### 3. Idle timer: 10 minutes

10 minutes balances resource usage against cold start latency for tasks with natural gaps between agent turns. Per-execution (stop after each `execute()`) would cause a CLI cold start on every task resume — unacceptably slow. Never-expiring would leak processes for inactive tasks.

**Note**: Timer resets on `getOrCreatePoolEntry()` call, not on SDK events. This means the 10-min clock represents "time since last task activity", which is the right semantic.

### 4. Shared singleton preserved for `listModels()`

`listModels()` is stateless and infrequent. Spawning a dedicated CLI just for model listing is wasteful. The existing `_sharedClientPromise` + port file pattern is kept unchanged.

### 5. `ping()` race on watchdog fire, wrapped in 5s timeout

`client.ping()` issues a JSON-RPC round-trip to the CLI process. It has no built-in timeout. If the CLI message loop is frozen (process running but not processing), `ping()` would hang. A `Promise.race` against a `setTimeout(5000)` bounds the check.

- Ping fails / times out → CLI dead → error immediately (current 120s becomes ~5s)
- Ping succeeds → CLI alive, session just silent → increment silence counter

**Note**: `client.getState()` was considered as a lighter alternative, but it only reflects TCP socket open/closed state — a hung CLI with an open socket would appear "connected". `ping()` is the correct check.

### 6. Silence counter N=3, reset on session event

Counter increments when: watchdog fires AND ping succeeds.  
Counter resets when: a real session event arrives (inside the existing `resetWatchdog()`-equivalent path in the `session.on()` callback).  
Fail when: counter reaches 3.  

At N=3 the maximum silence before error is 360s (3 × 120s). This covers slow LLM inference + long tool chains while still bounding stuck sessions.

The counter must be passed into `translateCopilotStream` through the adapter interface or as a closure. Since `events.ts` currently takes a `session` and `signal`, the cleanest option is an additional `onWatchdogFire: () => Promise<boolean>` callback — returns `true` if the CLI is healthy (ping succeeded), `false` if dead.

## Risks / Trade-offs

**Many concurrent tasks = many CLI processes**  
→ Mitigation: Typical Railyin boards have few concurrent tasks (3–8). Each CLI uses ~50–100 MB. The idle timer bounds total lifetime.

**Race: idle timer fires while `resumeSession` is starting**  
→ Mitigation: The timer callback only evicts if the timer reference stored in the map matches the current one. `getOrCreatePoolEntry()` atomically replaces the timer.

**`ping()` succeeds but session is broken (CLI running, session corrupted)**  
→ Mitigation: The silence counter catches this — after 3 consecutive silent windows, the session errors regardless of CLI health.

**Cold start latency on first use per task**  
→ Accepted trade-off. CLI startup takes ~1–2s; this is negligible relative to LLM response time.

## Migration Plan

1. `session.ts`: Replace `_clientPromise` with `_taskCliPool` map + idle timer logic. Add `getOrCreatePoolEntry()`. Keep `_sharedClientPromise` for `listModels()`. Remove per-task port file reads/writes.
2. `events.ts`: Add `onWatchdogFire` callback parameter to `translateCopilotStream`. On watchdog fire: call `onWatchdogFire()`, increment/reset silence counter accordingly.
3. `engine.ts`: Pass the `onWatchdogFire` callback when calling `translateCopilotStream` — the callback calls `adapter.pingClient(sessionId)`.
4. `session.ts`: Add `pingClient(sessionId): Promise<boolean>` to `CopilotSdkAdapter` interface (or implement inline via closure).

No data migrations. No schema changes. Rollback: revert the four files to pre-change state.

## Open Questions

*(none — all design decisions resolved during exploration)*
