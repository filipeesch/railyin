## Why

When multiple tasks execute concurrently using the Copilot engine, they all share a single CLI process through a module-level singleton. The Copilot CLI is single-process and serves requests serially — the second task's session receives no events while the first is running, triggering the 120s watchdog and producing false "connection timed out" errors. The fix is to give each task its own CLI process.

## What Changes

- Replace the module-level `_clientPromise` singleton in `session.ts` with a per-session CLI pool (`Map<sessionId, {clientPromise, idleTimer}>`), so each concurrent task gets an isolated CLI process
- Add a 10-minute idle timer per pool entry: the CLI is stopped and evicted when no `createSession`/`resumeSession` call arrives for 10 minutes
- Keep a separate shared singleton for `listModels()` — model listing does not need per-task isolation
- Remove the per-task port file (`~/.railyn/copilot-cli.port`) — pool entries are in-memory lifetime; the shared singleton continues using the port file for cross-restart reuse
- Enhance the 120s watchdog in `events.ts` with fail-fast detection: on each watchdog fire, race `client.ping()` against a 5s timeout — if ping fails or times out, error immediately (CLI dead)
- Add stuck-session detection: if the CLI is alive (ping succeeds) but the session produces no events for N=3 consecutive 120s windows, error with "session unresponsive" — the counter resets when real session events arrive

## Capabilities

### New Capabilities

*(none — all changes are improvements to an existing capability)*

### Modified Capabilities

- `copilot-engine`: Adding concurrency isolation (one CLI per task), fail-fast on CLI crash, and stuck-session detection after prolonged silence

## Impact

- `src/bun/engine/copilot/session.ts` — primary change: pool map, idle timer, `ping()` integration
- `src/bun/engine/copilot/events.ts` — watchdog enhancement: fail-fast ping check + silence counter
- No changes to `engine.ts`, `resolver.ts`, or any other file
- No breaking changes to the `CopilotSdkAdapter` interface
