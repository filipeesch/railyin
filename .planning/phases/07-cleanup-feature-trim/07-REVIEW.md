---
phase: 07-cleanup-feature-trim
reviewed: 2026-08-09T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/bun/engine/stream/stream-processor.ts
  - src/bun/engine/coordinator.ts
  - src/bun/engine/orchestrator.ts
  - src/bun/engine/types.ts
  - src/bun/index.ts
  - src/bun/server/notifications.ts
  - src/bun/engine/opencode/adapter.ts
  - src/bun/engine/opencode/engine.ts
  - src/bun/copilotkit/event-bridge.ts
  - src/bun/db/task-queries.ts
  - src/bun/handlers/legacy-import.ts
  - src/shared/rpc-types.ts
  - src/mainview/stores/task.ts
  - src/mainview/App.vue
  - src/mainview/rpc.ts
  - e2e/api/copilotkit/legacy-import.test.ts
  - e2e/api/smoke.test.ts
  - e2e/ui/chat-copilotkit.spec.ts
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-08-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the final cleanup phase: the zero-write `consume()` rewrite (stream-processor), the session-status push replacement (orchestrator/index/notifications), the A3 shell auto-approve posture (opencode engine/adapter), the AG-UI event bridge, the legacy-import retirement gate (`RAILYN_LEGACY_IMPORT`), the trimmed RPC/protocol surface, and the frontend store/wiring updates. Unit tests for the execution seam and AG-UI agent pass (50/50), and the e2e suites are consistent with the implementation.

The A2 (error-push drop) and A3 (auto-approve) decisions themselves are respected and not re-litigated. No critical bugs, data-loss paths, or ASVS L1 violations were found: the frozen tables (`conversation_messages`, `stream_events`, `model_raw_messages`) receive zero writes from `consume()`, the A3 default is **deny** when `shell_auto_approve` is not set, and the import RPC is absent over the wire when the flag is off.

However, five warnings surfaced. The most consequential is that board-driven runs (transition/retry/code-review and RPC-driven task turns) now have **no output surface at all** — the no-op `onToken` and the missing bridge tap mean their engine output is neither persisted nor pushed, which the task-drawer chat (now AG-UI/JSONL-backed) can no longer display. The other warnings cover an execution-state wedge when a generator ends without a `done` event, a race in the OpenCode permission reply path, the accidentally-deleted config-error UX, and a missing session-status broadcast in `cancel()`.

## Warnings

### WR-01: Board-driven runs drop all engine output — no persistence, no push, no AG-UI tap

**File:** `src/bun/engine/orchestrator.ts:80-84` (and `src/bun/engine/execution/transition-executor.ts:167`, `retry-executor.ts:132`, `code-review-executor.ts:194`, `src/bun/handlers/tasks.ts:261,280`)
**Issue:** `consume()`'s terminal writes and the AG-UI bridge tap are correct for chat/human turns (opts threaded through the agent), but:
1. `TransitionExecutor`, `RetryExecutor`, and `CodeReviewExecutor` call `runNonNative(...)` **without opts** → `opts?.onEngineEvent?.(event)` (stream-processor.ts:129) never fires for board-driven runs.
2. The orchestrator wires `onToken` as `() => {}` (orchestrator.ts:81), so token events for these runs reach nothing.
3. `handlers/tasks.ts` calls `executeHumanTurn` without opts (only `mergeSessionStatusOpts` is added, which adds just `onSessionStatusChange`), so RPC-driven task turns (including `CodeReviewOverlay.vue:660` → `tasks.sendMessage`) also drop output.

Combined with the zero-write rule (D-05), a task driven by board transitions produces **no transcript anywhere**: not in `conversation_messages` (frozen), not in JSONL (only the agent writes it), not on the wire. The task-drawer chat (AG-UI/JSONL, `RailyinChat`) shows an empty thread ("No messages yet") for a task that has genuinely run — a visible regression versus the pre-07 stack, where `ConversationBody` rendered the transition transcript. This consequence is not part of the human-gated A2/A3 decisions, so it should be surfaced.
**Fix:** Thread `ChatTurnOpts` (with `onEngineEvent` wired to the same translation/persistence path the agent uses, e.g., via `RailyinAgent`-style JSONL logging, or at minimum a task-scoped WS surface) into the transition/retry/code-review executors and the `tasks.sendMessage`/`tasks.submitDecisions` handler path — or explicitly document the drop in the phase summary so it is a tracked product decision.

### WR-02: `consume()` leaves the DB triad `running` when a generator ends without `done` — thread wedge

**File:** `src/bun/engine/stream/stream-processor.ts:229-244`
**Issue:** The post-loop only handles the aborted case. If a stream ends **without** a `done` event and **without** abort (e.g., the Pi engine's `fatal: false` error followed by end-of-stream — the exact shape referenced in `railyin-agent.ts`'s WR-02 guard), nothing writes a terminal state: `executions.status` stays `running` with `finished_at` NULL, and `tasks.execution_state` / `chat_sessions.status` stay `running`. The AG-UI stream is rescued by the agent's `guardedComplete()`, but the DB side is not:
- the task card shows "running" forever;
- the agent's advisory lock (`railyin-agent.ts:446-452`, `status IN ('running','waiting_user')`) rejects **all future runs** for that conversation with THREAD_BUSY — a permanent wedge until the row is manually fixed.
The old pre-07 `consume()` had the same blind spot, but this phase rewrote the state machine and was the moment to close it.
**Fix:** In the post-loop, treat end-of-stream as completion when not aborted: write `executions.status = 'completed'` + `finished_at`, flip task/session state to completed/idle, fire the terminal `onToken`/`onRunEnd("done")` (mirroring the `done` case). Alternatively, have engines guarantee `done` on every terminal path and add a defensive guard that asserts it.

### WR-03: OpenCode permission replies use a single-slot map — parallel `permission.asked` breaks the run

**File:** `src/bun/engine/opencode/adapter.ts:163-170, 206-216`
**Issue:** `pendingPermissions` is keyed by `executionId` with a single entry. The A3 handler stores the request, awaits `onPermissionAsked`, then awaits `respondPermission` (a network call). If a second `permission.asked` for the same execution arrives while the first reply is in flight:
1. `pendingPermissions.set(executionId, B)` overwrites A — A's `requestId` is never replied to, so the OpenCode session stalls on that permission;
2. A's `respondPermission` completes and deletes the entry;
3. B's `respondPermission` then finds no entry and **throws** `No pending permission for execution N`, propagating out of the async generator into `consume()`'s catch → the whole run is marked `failed`.

This is a correctness bug in the A3 implementation, not a re-litigation of the posture itself.
**Fix:** The map is unnecessary in the A3 path — the handler already holds `event.properties.id`. Pass `requestId` directly into the reply call (e.g., `respondPermission(requestId, decision)`), or keep a per-execution queue of pending requestIds. At minimum, make `respondPermission` drain/coalesce instead of overwrite, and never throw on a missing entry for an already-replied request.

### WR-04: A2 trim deleted the config-error UX, but the server still broadcasts it

**File:** `src/mainview/App.vue:45-52` (removed branch), `src/mainview/rpc.ts:78-96`, `src/bun/index.ts:499-506`, `src/shared/rpc-types.ts:1132-1137`
**Issue:** The old `onStreamError` handler had two responsibilities: (a) chat/task failure toasts — the A2-gated drop — and (b) the **config-error path** (`taskId === -1` sentinel → error toast + `router.push("/setup")`). The A2 trim deleted the whole handler, including (b). Consequences:
- `index.ts:499-506` still calls `notifier.broadcastConfigError(...)` when `loadConfig()` fails, but `config.error` is not in `PushMessage` and no frontend case handles it — a dead broadcast;
- with a broken config, `orchestrator` is null (`index.ts:244-246`), the app boots to `/board` without any redirect or toast, and every engine RPC fails with `Orchestrator not available` (500s) — the user gets an unlabeled broken app instead of the setup redirect they previously received.
The A2 decision covered failure toasts; the config-error redirect was collateral damage.
**Fix:** Re-add a minimal consumer — either a `config.error` case in `rpc.ts`'s WS switch (add the type to `PushMessage`) that routes to `/setup` with a toast, or have `workspaceStore.load()` detect the null-orchestrator condition and redirect. If the redirect is intentionally dropped, remove `broadcastConfigError` and the `notifications.test.ts` NS-6 test that pins it.

### WR-05: `orchestrator.cancel()` session branch doesn't broadcast the idle flip

**File:** `src/bun/engine/orchestrator.ts:200-206`
**Issue:** For standalone sessions, `cancel()` writes `chat_sessions.status = 'idle'` directly but never calls `sessionStatusCb(conversationId)` — the `chatSession.updated` push is expected from `consume()`'s abort path (stream-processor.ts:115). That works while a stream is active, but in the window where `consume()` never observes the abort (executor failure between the row insert and `runNonNative`, or an engine whose generator doesn't yield/end — see WR-02), the sidebar stays stuck on "running" with no push. This is exactly the Pitfall-2 failure mode this phase's session-status callback was built to replace, and `cancel()` is one of the paths that bypasses it.
**Fix:** After the idle write in `cancel()`'s session branch, call `this.sessionStatusCb(conversationId)` (or emit the push directly), mirroring the task branch's `onTaskUpdated` call at line 196.

## Info

### IN-01: Two import statements on one line

**File:** `src/mainview/App.vue:20`
**Issue:** `import { useSessionSyncHandler } from "./composables/useSessionSyncHandler";import { useBoardSyncHandler } from "./composables/useBoardSyncHandler";` — two statements on a single line, likely a merge artifact.
**Fix:** Split onto separate lines.

### IN-02: `emitDone` has no wire effect in the current wiring

**File:** `src/bun/engine/orchestrator.ts:198,205` / `src/bun/engine/stream/stream-processor.ts:57-59`
**Issue:** `emitDone()` calls `onToken(...)`, which the orchestrator wires as `() => {}` (orchestrator.ts:81). The AG-UI terminal in cancel flows is emitted by the agent via `onRunEnd("aborted")` from `consume()`, so `emitDone` is vestigial — harmless, but its comment ("used by cancel() when no active stream is running") describes a path that produces no observable effect. If the no-op `onToken` is the intended end state for non-AG-UI runs, `emitDone` and the comments should say so (ties into WR-01).

---

_Reviewed: 2026-08-09T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
