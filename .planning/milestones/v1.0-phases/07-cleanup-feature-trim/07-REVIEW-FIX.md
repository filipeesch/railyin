---
phase: 07-cleanup-feature-trim
fixed_at: 2026-08-09T23:20:00Z
review_path: .planning/phases/07-cleanup-feature-trim/07-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-08-09T23:20:00Z
**Source review:** `.planning/phases/07-cleanup-feature-trim/07-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (5 warnings, 2 info)
- Fixed: 7
- Skipped: 0

All findings from REVIEW.md were fixed. Each fix is committed atomically on
`copilotkit` (see per-finding commits below). Verification gates (typecheck,
backend unit suite, e2e API suite, frontend build, full Playwright suite) were
run from the isolated review-fix worktree against the exact tree that was then
fast-forwarded onto `copilotkit` (pure ff — byte-identical tree).

## Fixed Issues

### WR-01: Board-driven runs drop all engine output — no persistence, no push, no AG-UI tap

**Files modified:** `src/bun/copilotkit/board-run-logger.ts` (new), `src/bun/engine/execution/transition-executor.ts`, `src/bun/engine/execution/retry-executor.ts`, `src/bun/engine/execution/code-review-executor.ts`, `src/bun/engine/execution/human-turn-executor.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/index.ts`
**Commit:** `386b27ee`
**Applied fix:** Added `BoardRunLogger` (`src/bun/copilotkit/board-run-logger.ts`) — the same BRDG-01 translation path the RailyinAgent uses (`translateEngineEvent` + `synthesizeMissingToolResults` + `terminalEvent`), appending AG-UI BaseEvents to the conversation's JSONL thread log (`data/threads/{conversationId}.jsonl`): synthetic `RUN_STARTED` first (RUN_STARTED-FIRST wire contract), exactly one terminal per run, warn-only on persistence failure. The logger is threaded into `TransitionExecutor` / `RetryExecutor` / `CodeReviewExecutor` (constructor param, `runNonNative(..., buildOpts(conversationId, executionId))`) and into `HumanTurnExecutor` (merged into caller opts only when the caller has no `onEngineEvent` tap — AG-UI runs from the RailyinAgent are untouched). `index.ts` constructs it from the same `JsonlStore` the runner persists to (store creation moved before orchestrator construction), gated off the e2e mock engine so test servers never write board-run logs into the developer's real `~/.railyn` dir. The task-drawer chat (RailyinChat cold replay) now shows board-run output. Known limitation (documented): within one process, threads that already have in-memory AG-UI events take the runner's HOT connect path, which replays the in-memory buffer — board-run events in JSONL are only visible on the COLD path (fresh process). The primary scenario (task that ran via board with no prior AG-UI chat) is fully fixed.

### WR-02: `consume()` leaves the DB triad `running` when a generator ends without `done` — thread wedge

**Files modified:** `src/bun/engine/stream/stream-processor.ts`
**Commit:** `09a57bd5`
**Applied fix:** The post-loop now distinguishes the two exits with a `sawDoneEvent` flag. When the generator ended without abort AND without a `done` event (e.g. Pi `fatal: false` error followed by end-of-stream), it finalizes exactly like the `done` case: `executions.status='completed'` + `finished_at`, task `completed` / session `idle` (with the session-status push), terminal `onToken` + `onRunEnd("done")`. The DB triad can no longer stay `running` forever, so the task card never spins and the agent's advisory lock (THREAD_BUSY) never wedges the conversation.

### WR-03: OpenCode permission replies use a single-slot map — parallel `permission.asked` breaks the run

**Files modified:** `src/bun/engine/opencode/adapter.ts`, `src/bun/engine/opencode/types.ts`, `src/bun/test/support/opencode-sdk-mock.ts`
**Commit:** `bcdd65cd`
**Applied fix:** The `pendingPermissions` map is deleted. The `permission.asked` handler passes the event's own `requestId` (`event.properties.id`) directly into `respondPermission(requestId, decision)`; the event loop processes asks sequentially, so each request answers its own id — no overwrite, no `No pending permission` throw. Interface and e2e mock updated to the new signature.

### WR-04: A2 trim deleted the config-error UX, but the server still broadcasts it

**Files modified:** `src/bun/index.ts`, `src/bun/server/notifications.ts`, `src/bun/test/server/notifications.test.ts`
**Commit:** `ab3ad1c5`
**Applied fix:** No live consumer exists (`config.error` is not in `PushMessage`; `rpc.ts` has no case; the App.vue handler was removed in 07-03 and 07-01-PLAN.md recorded the drop decision), so per the review guidance the dead broadcast was removed: the index.ts `broadcastConfigError` block, the `NotificationService.broadcastConfigError` method, and the NS-6 test that pinned it. `configError` still gates orchestrator construction. Note: the reviewer's "broken config boots to a dead board" UX gap is intentionally left as a tracked product decision (the A2 trim dropped failure toasts; the setup-redirect flow still triggers when no workspace config exists via `workspaceStore.isConfigured()`).

### WR-05: `orchestrator.cancel()` session branch doesn't broadcast the idle flip

**Files modified:** `src/bun/engine/orchestrator.ts`
**Commit:** `c957b587`
**Applied fix:** The session branch's `chat_sessions.status='idle'` write now fires `this.sessionStatusCb(conversationId)` inside the existing `conversationId` guard, mirroring the task branch's `onTaskUpdated` call. The sidebar can no longer stay stuck on "running" in the window where `consume()` never observes the abort (executor failure before `runNonNative`, or a generator that never yields again — WR-02).

### IN-01: Two import statements on one line

**Files modified:** `src/mainview/App.vue`
**Commit:** `5b6f6eda`
**Applied fix:** Split `useSessionSyncHandler` / `useBoardSyncHandler` imports onto separate lines.

### IN-02: `emitDone` has no wire effect in the current wiring

**Files modified:** `src/bun/engine/stream/stream-processor.ts`, `src/bun/engine/orchestrator.ts`
**Commit:** `c68cc4b5`
**Applied fix:** `emitDone()` only called `onToken`, which the orchestrator wires as a no-op; the AG-UI terminal in cancel flows is emitted by the agent via `onRunEnd("aborted")` from `consume()`. Removed the method and both `cancel()` call sites (the WR-05 push and the task branch's `onTaskUpdated` are the real cancel surfaces).

## Verification

Gates ran in the **isolated review-fix worktree** (`/tmp/sv-07-reviewfix-*` on branch `gsd-reviewfix/07-20876`) against the exact tree fast-forwarded onto `copilotkit` (pure ff — byte-identical tree, verified post-ff). Note: the worktree used a symlinked `node_modules` (never removed with `rm -rf`); the worktree was torn down via `git worktree remove --force` after the ff.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` (`tsc --noEmit`) | pass (0 errors) |
| Backend unit suite | `bun test src/bun --timeout 20000` | 2253 pass / 0 fail / 2 pre-existing skips |
| e2e API suite | `bun test e2e/api --timeout 30000` | 84 pass / 0 fail |
| Frontend build | `bun run build` | pass (built in ~19s; pre-existing chunk-size warnings only) |
| Full Playwright | `bun run test:e2e` | 518 passed / 0 failed / 8 pre-existing skipped |

---

_Fixed: 2026-08-09T23:20:00Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
