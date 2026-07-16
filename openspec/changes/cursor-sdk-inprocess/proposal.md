## Why

The Cursor engine runs `@cursor/sdk` in a dedicated Node.js subprocess (`worker.mjs`) because Bun's HTTP/2 client previously broke the SDK's local-agent streaming (`ERR_HTTP2_SESSION_ERROR: Session closed with error code 6`), verified live against the real Cursor API on Bun `1.4.0-canary.1` with `@cursor/sdk@1.0.18` (3/3 runs failed). The same live repro against `@cursor/sdk@1.0.23` (published 2026-07-03, five patch releases after `1.0.18`) succeeded on the identical Bun build in 8/8 runs with zero HTTP/2 errors — the root cause was fixed upstream in Cursor's own SDK/backend, unrelated to the Bun runtime bug our original design doc assumed. With the underlying incompatibility gone, the subprocess bridge, its IPC protocol, and the duplicated event-translation logic it required are no longer necessary and add ongoing maintenance cost (process lifecycle, `node` binary dependency, IPC serialization, a second copy of `translate-events.ts` that must be kept in sync by hand).

## What Changes

- Bump `@cursor/sdk` from `^1.0.18` to the latest published version (`^1.0.23` or newer at implementation time) in `package.json`.
- **BREAKING (internal only, no external API change)**: Replace `SubprocessCursorAdapter` (`worker-client.ts` + `worker.mjs`) with a new in-process adapter that calls `@cursor/sdk`'s `Agent`/`Cursor` APIs directly from the Bun main process. `CursorSdkAdapter`'s public interface (`run`, `cancel`, `listModels`, `listCommands`, `shutdownAll`) is unchanged, so `engine.ts` and `tools.ts` require no changes.
- Remove the Node subprocess and its supporting files: `worker.mjs`, `worker-client.ts`, `worker-protocol.ts` (IPC wire types no longer needed).
- Port the pure, already-tested recovery/resume logic (`sendWithBusyRetry`, `resumeOrCreateAgent`, `isBusyLikeError`, `PersistentBusyError`) from `worker-recovery.mjs` / `worker-resume.mjs` into TypeScript modules usable directly by the in-process adapter — no behavior change, only removing the ESM/Node-subprocess constraint that forced them into `.mjs`.
- Remove the duplicated inline copy of `translate-events.ts` logic that lived in `worker.mjs` (marked in its own comment as "CRITICAL: must stay in sync") — the in-process adapter uses `translate-events.ts` directly, eliminating the duplication and its sync-drift risk.
- Remove `RAILYIN_CURSOR_NODE` env var and `CursorAdapterOptions.workerScriptPath` — both become dead configuration once there is no subprocess to spawn or point at an alternate `node` binary.
- Port `setMaxListeners(0)` (currently scoped to the dedicated worker process to suppress a known SDK abort-listener accumulation warning) into the in-process adapter's module scope, applied to the shared Bun process. Accepted as a flagged risk without a soak-test gate (per user decision) — the underlying SDK-side listener accumulation is a property of the SDK itself, not of running in a dedicated subprocess.

## Capabilities

### New Capabilities

(none — this change modifies the existing `cursor-sdk` capability in place; no new capability surface is introduced)

### Modified Capabilities

- `cursor-sdk`: Replaces the "Subprocess-isolated SDK runtime" requirement (worker spawn, IPC handshake, worker crash recovery, `RAILYIN_CURSOR_NODE`) with an in-process runtime requirement. Requirements describing agent lifecycle (deterministic `agentId`, resume/create fallback, `AgentBusyError` retry), streaming event translation, and tool registration are preserved with updated wording reflecting direct in-process calls instead of IPC message passing.

## Impact

- **Files removed**: `src/bun/engine/cursor/worker.mjs`, `src/bun/engine/cursor/worker-client.ts`, `src/bun/engine/cursor/worker-protocol.ts`
- **Files added**: `src/bun/engine/cursor/inprocess-adapter.ts` (in-process adapter, constructor-injectable `{ Agent, Cursor }` SDK client), TypeScript ports of `worker-recovery.mjs` → `recovery.ts`, `worker-resume.mjs` → `resume.ts`, and `worker.mjs`'s `buildBaseOptions` → `options.ts`
- **Files modified**: `src/bun/engine/cursor/adapter.ts` (factory now constructs the in-process adapter instead of `SubprocessCursorAdapter`), `package.json` (`@cursor/sdk` version bump)
- **Test files removed**: `src/bun/test/cursor/worker-client.test.ts`, `src/bun/test/cursor/fixtures/test-worker.mjs` (real-subprocess-plus-stub-fixture strategy has no replacement target once the subprocess is gone), `src/bun/engine/cursor/translate-consistency.test.ts` (asserted a duplicate that no longer exists once removed)
- **Test files added**: `src/bun/engine/cursor/inprocess-adapter.test.ts` — new unit coverage for run orchestration (stream loop, `run.wait()` status mapping, cleanup-on-finally, busy-retry) that had no direct unit coverage before, made possible by constructor-injecting the SDK client
- **Test files updated (import path only, assertions unchanged)**: `src/bun/test/cursor/worker-send-retry.test.ts`, `src/bun/test/cursor/worker-resume.test.ts`, `src/bun/test/cursor/worker-options.test.ts`
- **Test files unchanged**: `src/bun/test/cursor/rpc-scenarios.test.ts`, `src/bun/test/cursor/engine.test.ts`, `src/bun/test/cursor-dialect.test.ts`, `e2e/ui/cursor.spec.ts` — all mock at the `CursorSdkAdapter` interface or the HTTP/WS boundary, unaffected by the concrete adapter swap
- **No changes** to `src/bun/engine/cursor/engine.ts`, `src/bun/engine/cursor/tools.ts`, `src/bun/engine/cursor/translate-events.ts`, or `src/bun/engine/dialects/cursor-dialect.ts` — the adapter's public contract (`CursorSdkAdapter`) is unchanged, per the existing decision to keep `engine.ts` transport-agnostic
- **Dependency**: `@cursor/sdk` version bump from `^1.0.18` to `^1.0.23`+ (verified compatible with Bun 1.4.0 via live repro)
- **Removed operational dependency**: no longer requires a `node` binary on PATH (or `RAILYIN_CURSOR_NODE` override) for the Cursor engine to function
- **Reduced memory footprint**: eliminates the ~50-80 MB resident Node subprocess that was kept alive while the Cursor engine is in use
