## Context

The Cursor engine currently runs `@cursor/sdk` inside a dedicated Node.js subprocess (`src/bun/engine/cursor/worker.mjs`), talking to the Bun parent process over stdio-based IPC (`worker-client.ts` / `worker-protocol.ts`). This design existed because Bun's `node:http2` client broke `@cursor/sdk`'s local-agent HTTP/2 streaming with `ERR_HTTP2_SESSION_ERROR: Session closed with error code 6`. A live repro against the real Cursor API established:

- Bun `1.4.0-canary.1` + `@cursor/sdk@1.0.18` (currently pinned): fails 3/3 runs.
- Bun `1.4.0-canary.1` + `@cursor/sdk@1.0.23` (latest, no other changes): succeeds 8/8 runs, zero HTTP/2 errors.
- Node v20 + `@cursor/sdk@1.0.18` (control): succeeds — confirms the bug is Bun-specific, but only for `1.0.18`.

This means the fix landed in `@cursor/sdk` itself somewhere between `1.0.18` and `1.0.23`, not in Bun. Bun's own issue tracker (bun#31499, filed against `1.4.0-canary.1`, closed `not_planned`) corroborates this: Bun's investigation could not reproduce the failure synthetically and suspected the RST_STREAM/GOAWAY originated from the Cursor relay server, not from Bun's inbound frame handling — the opposite direction of causation from the original design doc's theory (`archive/2026-06-16-cursor-sdk-engine/design.md`, Decision 6).

With the SDK bumped past the fix, the subprocess/IPC architecture becomes unnecessary complexity: process lifecycle management, a hand-maintained duplicate of `translate-events.ts` inside `worker.mjs` (explicitly flagged as a sync-drift risk in its own comments), a bespoke tool-call proxy protocol, and a `node` binary runtime dependency.

The active, unarchived `fix-cursor-engine` change (17/17 tasks complete) already modified `worker.mjs` / `adapter.ts` / `engine.ts` for unrelated fixes (slash commands, skills injection, `AgentBusyError` recovery). Per user decision, this change builds on top of that change's current on-disk state; the user will reconcile the `fix-cursor-engine` openspec artifacts separately.

## Goals / Non-Goals

**Goals:**
- Remove the Node subprocess, its IPC protocol, and the duplicated event-translation logic it required.
- Preserve the existing `CursorSdkAdapter` public interface exactly, so `engine.ts`, `tools.ts`, and `cursor-dialect.ts` require zero changes.
- Reuse the already-extracted, pure recovery/resume logic (`sendWithBusyRetry`, `resumeOrCreateAgent`, `isBusyLikeError`, `PersistentBusyError`) with no behavioral change — only lift the Node-subprocess-only `.mjs` constraint so they can live as ordinary `.ts` modules.
- Bump `@cursor/sdk` to the latest version (caret range) as the change that actually fixes the underlying bug.
- Follow the existing DI seam: `createDefaultCursorSdkAdapter()` in `adapter.ts` remains the single wiring point; only its internals change.
- Remove now-dead configuration (`RAILYIN_CURSOR_NODE`, `CursorAdapterOptions.workerScriptPath`).

**Non-Goals:**
- No change to `CursorEngine`, `CursorDialect`, custom tool schemas, or any Railyin-facing behavior (prompt composition, slash-command resolution, skill injection, project rules, `AgentBusyError` retry policy) — these are ported as-is, just without the IPC hop.
- No new test *infrastructure* (frameworks, runners, fixtures architecture) is designed here. Test *scenarios* are extrapolated directly from the spec deltas and mapped 1:1 onto existing coverage in `src/bun/test/cursor/` and `src/bun/engine/cursor/*.test.ts` (see "Test alignment" below) — no code changes are proposed solely to enable testing.
- No change to how `engines.yaml` / `CURSOR_API_KEY` configuration is read.
- No attempt to further split `CursorSdkAdapter` into smaller interfaces beyond what already exists — the existing seam is already appropriately scoped (SRP: one adapter, one job — talk to the SDK).

## Test alignment (mapped from existing coverage, not newly designed)

Exploration of `src/bun/test/cursor/`, `src/bun/engine/cursor/*.test.ts`, and `e2e/` against the spec deltas above found:

- **Integration (in-memory DB, RPC) and Playwright suites need no changes.** `rpc-scenarios.test.ts`, `engine.test.ts`, `cursor-dialect.test.ts`, and `e2e/ui/cursor.spec.ts` all mock at the `CursorSdkAdapter` interface (via `MockCursorSdkAdapter`) or the HTTP/WS boundary — swapping the concrete adapter class underneath is invisible to them.
- **`worker-client.test.ts` has no direct replacement.** It spawns a real Node subprocess against a hand-written stub (`test-worker.mjs`) that fakes the *wire protocol* — it never exercised `handleStartRun`'s real orchestration logic (stream loop, `run.wait()` mapping, `finalizeRunState` cleanup). This is deleted, not ported.
- **This orchestration logic gains unit coverage for the first time**, made possible by decision 1a (injectable `{ Agent, Cursor }` client): a new `inprocess-adapter.test.ts` exercises the real `run()`/`cancel()`/`listModels()` code paths with a fake SDK client, no subprocess or live API key required.
- **`worker-send-retry.test.ts`, `worker-resume.test.ts`, `worker-options.test.ts`** need only an import-path change (`worker.mjs`/`worker-recovery.mjs`/`worker-resume.mjs` → `recovery.ts`/`resume.ts`/`options.ts`) — the pure functions and their assertions are unchanged.
- **`translate-consistency.test.ts` is deleted, not migrated.** It exists solely to assert `worker.mjs`'s inline duplicate of the translation logic matches `translate-events.ts`; removing the duplicate (the whole point of this change) removes the thing the test compares against. This is a direct, mechanical consequence of the dedup — not a testing-motivated code change.

## Decisions

### 1. In-process adapter replaces subprocess adapter, same public interface

`SubprocessCursorAdapter` (in `worker-client.ts`) is replaced by a new `InProcessCursorAdapter` implementing the same `CursorSdkAdapter` interface (`run`, `cancel`, `listModels`, `listCommands`, `shutdownAll`). `createDefaultCursorSdkAdapter()` is updated to construct the new class. This is the Dependency Inversion win already banked by the prior design: callers depend on the `CursorSdkAdapter` interface, not a concrete class, so this swap is contained to one factory function and one new implementation file.

**Alternatives considered:**
- *Keep the subprocess, just bump the SDK version* — rejected: the subprocess buys nothing once the root cause is fixed; it only adds maintenance surface (duplicated translation logic, IPC protocol, process supervision) for no remaining benefit.
- *Merge the adapter directly into `engine.ts`* — rejected: violates SRP (engine orchestration vs. SDK transport are different concerns) and would make future re-introduction of process isolation (if a new Bun regression appears) much harder to scope.

### 1a. `InProcessCursorAdapter` takes the SDK client as an injectable constructor parameter

The adapter's constructor accepts an optional `{ Agent, Cursor }` client object, defaulting to the real `@cursor/sdk` exports when omitted — the same shape `recovery.ts`'s `sendPromptWithRecovery(Agent, ...)` and `resume.ts`'s `resumeOrCreateAgent(Agent, ...)` already use. `createDefaultCursorSdkAdapter()` remains the only place that wires up the real client.

This decision came directly out of test-coverage exploration: `handleStartRun`'s orchestration logic (stream loop, `run.wait()` status mapping, `finalizeRunState` cleanup, busy-retry) has **no direct unit coverage today** — `worker-client.test.ts` only exercises a hand-written stub (`test-worker.mjs`) that fakes the wire protocol, never the real function. Constructor injection is what makes this orchestration logic unit-testable in-process, with a fake `Agent`/`Cursor`, instead of requiring a real subprocess-plus-fixture or a live API key.

**Alternatives considered:**
- *Hard-import `@cursor/sdk` at module scope (mirroring `worker.mjs`'s current style)* — rejected: makes the adapter's control flow untestable without either a real network call or `vi.mock('@cursor/sdk')` module-level mocking, which is more brittle than parameter injection and breaks the DI convention already established one layer down in `recovery.ts`/`resume.ts`, creating inconsistency within the same file family.

### 1b. `buildBaseOptions` gets its own `options.ts` module

`buildBaseOptions` (assembles the `Agent.create`/`Agent.resume` options object: model, apiKey, cwd, customTools, `settingSources`) currently lives directly inside `worker.mjs` — not in `worker-recovery.mjs` or `worker-resume.mjs` — and was missing from the initial file inventory in this design. It is ported to a new `src/bun/engine/cursor/options.ts` module rather than folded into `recovery.ts`, `resume.ts`, or the adapter file itself.

**Alternatives considered:**
- *Inline it as a private/exported-for-testing helper inside `inprocess-adapter.ts`* — rejected: this is a pure, single-purpose function with no dependency on retry/resume logic; giving it its own file matches the existing one-function-per-file granularity already used for `worker-resume.mjs`, keeps `recovery.ts`/`resume.ts` focused on their existing single responsibilities (SRP), and lets `worker-options.test.ts` be updated with a one-line import change instead of restructuring its test target.

### 2. Recovery/resume helpers ported to TypeScript, logic untouched

`worker-recovery.mjs` and `worker-resume.mjs` become `.ts` modules (e.g. `recovery.ts`, `resume.ts`) under `src/bun/engine/cursor/`, callable directly by `InProcessCursorAdapter`. Only the module boundary changes (no more forced plain-ESM-for-Node-subprocess constraint); the retry/backoff logic itself is copied verbatim to avoid introducing new bugs in already-validated code (these functions were added and tested under `fix-cursor-engine`, tasks 4.1-4.3, 9.1-9.2).

**Alternatives considered:**
- *Rewrite the retry logic inline in the new adapter* — rejected: would re-derive already-correct logic and lose the existing unit-testable, framework-agnostic seam for no benefit.

### 3. Tool execution becomes direct, no proxy protocol

Currently, custom tools cross the IPC boundary twice per call: schema-only export from Bun → worker, then a `toolCall`/`toolResult` message pair per invocation, with the worker awaiting Bun's response. In-process, the tool's `execute` closure is passed directly into the SDK's `local.customTools` option and the SDK calls it in the same call stack — no serialization, no `callId` bookkeeping, no promise-based proxy.

**Alternatives considered:**
- *Keep a thin internal "proxy" abstraction in case process isolation is needed again later* — rejected as premature abstraction (YAGNI): if a future Bun/SDK regression forces reintroducing isolation, that's a new design problem best solved with full context at the time, not a speculative seam carried today.

### 4. `translate-events.ts` becomes the single source of truth

`worker.mjs` contained an inline, hand-synced copy of the event-translation logic (its own comment: "CRITICAL: This copy MUST stay in sync with translate-events.ts") because Node couldn't import the canonical `.ts` file directly. Removing the subprocess removes the reason for the duplicate entirely — the in-process adapter imports `translate-events.ts` directly.

### 5. `setMaxListeners(0)` ported as-is, accepted as a process-wide risk

Per explicit user decision, the suppression is moved into the new adapter's module scope with no additional guarding or soak testing. The underlying cause (`@cursor/sdk` accumulating abort listeners on shared internal `AbortSignal`s across `Agent.create`/`resume` calls without full teardown on `agent.close()`) is a property of the SDK, not of subprocess isolation — so moving in-process doesn't change the underlying leak, only widens the blast radius of the *warning suppression* to the whole Bun process. Flagged in Risks below; no code path currently relies on `MaxListenersExceededWarning` being visible elsewhere in the process, so the risk is judged acceptable without further mitigation at this time.

### 6. Dead configuration removed, not deprecated

`RAILYIN_CURSOR_NODE` and `workerScriptPath` are deleted outright rather than left as no-op flags, since they have no meaning once there is no subprocess to configure. This is a clean removal, not a soft-deprecation, because these are internal implementation knobs (not part of any external/documented API contract).

## Risks / Trade-offs

- **[Risk] `setMaxListeners(0)` now suppresses listener-leak warnings for the entire Bun server process, not just an isolated worker** → **Mitigation**: Accepted per explicit user decision; no other part of the Bun process currently generates high-volume `AbortSignal` listeners, so masking is judged low-blast-radius. Revisit if an unrelated listener leak elsewhere in the process needs this warning to be visible.
- **[Risk] An SDK-internal crash or unhandled rejection now terminates in the same process as the rest of the Bun server, instead of being contained to a disposable subprocess** → **Mitigation**: The adapter wraps all SDK calls in try/catch and surfaces failures as `EngineEvent.error`; no code path should let an SDK exception propagate unguarded to the Bun process's top level. This should be verified during implementation (existing test coverage for error paths should be preserved, not expanded, per the current scope).
- **[Risk] Removing `RAILYIN_CURSOR_NODE` and `workerScriptPath` is a breaking change for any deployment that set them** → **Mitigation**: These are internal/undocumented-beyond-code config knobs, not part of `engines.yaml`'s documented schema; impact is limited to whoever manually set the env var, which is unlikely outside this repo's own history. Call out in the proposal/changelog.
- **[Trade-off] Losing subprocess isolation means a future *unrelated* Bun regression affecting the SDK's networking would again require either a workaround or reintroducing isolation** → Accepted: the alternative (keeping speculative isolation "just in case") carries certain, ongoing maintenance cost (duplicated translation logic, IPC protocol) against a merely possible future cost. Re-introducing isolation later, if ever needed, is a bounded, well-understood change given the clean `CursorSdkAdapter` seam.

## Migration Plan

1. Bump `@cursor/sdk` to the latest caret range in `package.json`; run `bun install`.
2. Add TypeScript ports of `worker-recovery.mjs` → `recovery.ts` and `worker-resume.mjs` → `resume.ts` (logic unchanged).
3. Implement `InProcessCursorAdapter` in a new file, using the ported recovery/resume helpers and calling `@cursor/sdk`'s `Agent`/`Cursor` APIs directly; wire in `translate-events.ts` directly (no copy).
4. Update `createDefaultCursorSdkAdapter()` in `adapter.ts` to construct `InProcessCursorAdapter`; remove `workerScriptPath` from `CursorAdapterOptions`.
5. Remove `worker.mjs`, `worker-client.ts`, `worker-protocol.ts`, and the `RAILYIN_CURSOR_NODE` references.
6. Manually re-run the live repro (real Cursor API key, Bun 1.4.0, bumped SDK) against the new in-process adapter to confirm parity before considering this done — no new automated test infra is being designed in this change, but a manual smoke check is part of "implementation done," not "design done."
7. **Rollback strategy**: since this is a pre-release/internal change (no external users of the removed config knobs known), rollback is a straightforward `git revert` of the implementation commit(s); no data migration or backward-compatibility shim is needed because no persisted state changes shape.

## Open Questions

- Should `recovery.ts`/`resume.ts` keep their current file-level API surface unchanged, or is this a good opportunity to also tighten their exported types now that they're plain TypeScript? (Leaning: keep as-is for this change — minimize surface area of change per the user's incremental-decision pattern so far; revisit typing improvements as a separate, later cleanup if desired.)
- Exact patch version within `1.0.19`–`1.0.23` where the SDK fix landed was not pinpointed during investigation (not necessary for this change, since we bump straight to latest) — no action needed, noted for completeness only.
