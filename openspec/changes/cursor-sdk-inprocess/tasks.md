## 1. Dependency bump

- [ ] 1.1 Bump `@cursor/sdk` in `package.json` from `^1.0.18` to the latest published version using a caret range (e.g. `^1.0.23` or newer at implementation time)
- [ ] 1.2 Run `bun install` and verify `bun.lock` updates cleanly with no unrelated diffs
- [ ] 1.3 Manually re-run the live repro (real `CURSOR_API_KEY`, Bun 1.4.0, bumped SDK, current subprocess adapter still in place) to reconfirm the fix before touching the adapter implementation

## 2. Port pure helpers to TypeScript

- [ ] 2.1 Create `src/bun/engine/cursor/recovery.ts` porting `sendWithBusyRetry`, `isBusyLikeError`, `sendPromptWithRecovery`, `PersistentBusyError` from `worker-recovery.mjs` verbatim (logic unchanged, only module syntax updated to TS)
- [ ] 2.2 Create `src/bun/engine/cursor/resume.ts` porting `resumeOrCreateAgent` from `worker-resume.mjs` verbatim
- [ ] 2.3 Create `src/bun/engine/cursor/options.ts` porting `buildBaseOptions` from `worker.mjs` verbatim (own module per decision — keeps `recovery.ts`/`resume.ts` single-purpose; this function was missing from the original file inventory)
- [ ] 2.4 Add/port type annotations for all three modules' exported functions consistent with existing `adapter.ts` types

## 3. In-process adapter implementation

- [ ] 3.1 Create `src/bun/engine/cursor/inprocess-adapter.ts` implementing the `CursorSdkAdapter` interface (`run`, `cancel`, `listModels`, `listCommands`, `shutdownAll`)
- [ ] 3.2 Constructor accepts an injectable `{ Agent, Cursor }` SDK client parameter, defaulting to the real `@cursor/sdk` exports when omitted — mirrors the existing DI pattern in `recovery.ts`/`resume.ts` (`Agent` passed as a function parameter) and is what makes the adapter unit-testable with a fake client instead of a real subprocess/network call
- [ ] 3.3 Implement `run()`: derive/accept `agentId`, call `resumeOrCreateAgent` (from `resume.ts`) against the injected `Agent.create`/`Agent.resume`, register `customTools` directly (schema + `execute` together, no serialization), and translate SDK stream events to `EngineEvent`s using `translate-events.ts` directly (no copy)
- [ ] 3.4 Implement busy-agent handling in `run()` using `sendWithBusyRetry`/`PersistentBusyError` from `recovery.ts`, preserving the same retry-then-recreate-same-id behavior as the current worker
- [ ] 3.5 Port `run.wait()` → `runDone` status mapping from `handleStartRun` (`worker.mjs`): `status: "error"` → fatal `EngineEvent.error` with SDK detail or "Cursor agent run failed with no detail" fallback; `wait()` throwing → fatal error with `wait() threw: ...` detail; otherwise `type: "done"`
- [ ] 3.6 Port `finalizeRunState` behavior: always call `run.cancel()` (swallow rejection) then `agent.close()` (swallow rejection) in a `finally`, regardless of success/error/abort path
- [ ] 3.7 Implement `listModels()` calling the injected `Cursor.models.list({ apiKey })` directly, preserving current empty-array-and-warn behavior on missing API key, and the same field mapping (`value`, `displayName`, `description`, `supportsThinking`, `variants`, `parameters`)
- [ ] 3.8 Implement `listCommands()` preserving the existing DB-path-resolution + `CursorDialect.listCommands()` delegation, unchanged from current behavior
- [ ] 3.9 Implement `cancel()` and `shutdownAll()` for in-process run bookkeeping (no process to kill, but active runs/agents still need cancellation semantics — abort flag + `run.cancel()`, no more IPC `cancelRun` message)
- [ ] 3.10 Call `setMaxListeners(0)` once at module load, porting the existing suppression as-is (accepted risk, no additional guarding)
- [ ] 3.11 Ensure `settingSources: ["project"]` is included in all `Agent.create`/`Agent.resume` calls (via `options.ts`'s `buildBaseOptions`)
- [ ] 3.12 Drop the `pendingTools`/`callId`/proxy-tool bookkeeping entirely — custom tools' `execute` is called directly by the SDK in-process, no promise-based proxy or `toolCall`/`toolResult` matching needed

## 4. Wire up the DI seam

- [ ] 4.1 Update `createDefaultCursorSdkAdapter()` in `adapter.ts` to construct `InProcessCursorAdapter` instead of `SubprocessCursorAdapter`
- [ ] 4.2 Remove `workerScriptPath` from `CursorAdapterOptions`
- [ ] 4.3 Verify `src/bun/index.ts`'s existing call site (`createDefaultCursorSdkAdapter({ apiKey: cursorCfg.api_key })`) needs no changes

## 5. Remove subprocess machinery

- [ ] 5.1 Delete `src/bun/engine/cursor/worker.mjs`
- [ ] 5.2 Delete `src/bun/engine/cursor/worker-client.ts` (and its `SubprocessCursorAdapter` class)
- [ ] 5.3 Delete `src/bun/engine/cursor/worker-protocol.ts` (IPC wire types)
- [ ] 5.4 Delete the now-superseded `worker-recovery.mjs` and `worker-resume.mjs` (logic already ported in section 2)
- [ ] 5.5 Remove all `RAILYIN_CURSOR_NODE` references (adapter options, docs, env samples)
- [ ] 5.6 Grep the codebase for any remaining references to `worker.mjs`, `worker-client`, `worker-protocol`, `RAILYIN_CURSOR_NODE`, or `workerScriptPath` and clean up stragglers (docs, comments, config samples)

## 6. Test alignment

Mapped against current coverage in `src/bun/test/cursor/`, `src/bun/engine/cursor/`, and `e2e/`. Unit-level tests are new; integration (in-memory DB, RPC) and Playwright suites already mock at the `CursorSdkAdapter`/HTTP boundary and need no changes.

- [ ] 6.1 Delete `src/bun/test/cursor/worker-client.test.ts` and `src/bun/test/cursor/fixtures/test-worker.mjs` — the real-subprocess-plus-stub-fixture strategy has no replacement target once the subprocess is removed; its scenarios are superseded by the new unit tests in 6.2
- [ ] 6.2 Create `src/bun/engine/cursor/inprocess-adapter.test.ts` (colocated like `translate-events.test.ts`) using an injected fake `{ Agent, Cursor }` client (per the constructor-injection decision in section 3.2) to cover, at minimum:
  - Stream loop yields translated `EngineEvent`s in order via the real `translate-events.ts` import (no copy to diverge from)
  - `run.wait()` returning `status: "error"` maps to a fatal `EngineEvent.error` with the SDK's `result` detail, and to the "Cursor agent run failed with no detail" fallback string when `result` is omitted
  - `run.wait()` throwing maps to a fatal error whose message includes `wait() threw: ...`
  - Cancel: aborting mid-stream stops event emission and does not emit a terminal `done`/error after the abort (parity with the current `state.aborted` guard)
  - `finalizeRunState` equivalent always calls `run.cancel()` then `agent.close()` in a `finally`, even when `run.cancel()` rejects (swallowed) or the run errored
  - `PersistentBusyError` from `recovery.ts` surfaces its `failureKind` on the emitted fatal error event
  - A registered custom tool's `execute` is invoked directly during a run (no `callId`/proxy bookkeeping — this machinery is deleted, not ported)
  - `listModels()`: empty array + warning log when no API key; correct field mapping (`value`/`displayName`/`description`/`supportsThinking`/`variants`/`parameters`) from the injected `Cursor.models.list` fake
- [ ] 6.3 Update `src/bun/test/cursor/worker-send-retry.test.ts` to import `sendWithBusyRetry`/`sendPromptWithRecovery`/`PersistentBusyError` from `recovery.ts` instead of `worker.mjs` — assertions unchanged
- [ ] 6.4 Update `src/bun/test/cursor/worker-resume.test.ts` to import `resumeOrCreateAgent` from `resume.ts` instead of `worker-resume.mjs` — assertions unchanged
- [ ] 6.5 Update `src/bun/test/cursor/worker-options.test.ts` to import `buildBaseOptions` from `options.ts` instead of `worker.mjs` — assertions unchanged
- [ ] 6.6 Delete `src/bun/engine/cursor/translate-consistency.test.ts` — it exists solely to assert `worker.mjs`'s inline duplicate of the translation logic matches `translate-events.ts`; once the duplicate is removed (task 3.3/5.1) there is nothing left to compare
- [ ] 6.7 Run `src/bun/test/cursor/rpc-scenarios.test.ts`, `src/bun/test/cursor/engine.test.ts`, and `src/bun/test/cursor-dialect.test.ts` unmodified and confirm they still pass — they mock at the `CursorSdkAdapter` interface via `MockCursorSdkAdapter`/`createCursorRpcRuntime` and should require no changes
- [ ] 6.8 Run `e2e/ui/cursor.spec.ts` (Playwright) unmodified and confirm it still passes — it mocks HTTP/WS entirely and has no visibility into the adapter implementation
- [ ] 6.9 Manually re-run the live repro end-to-end against the new in-process adapter (real API key, Bun 1.4.0) to confirm streaming, tool calls, and agent resume all work identically to the old subprocess path
- [ ] 6.10 Confirm no `node` binary invocation remains anywhere in the Cursor engine code path (e.g. `grep -r "spawn.*node" src/bun/engine/cursor`)
- [ ] 6.11 Sanity-check the `openspec/specs/cursor-sdk/spec.md` delta applies cleanly with `openspec validate` before archiving
