## Context

When an execution ends, `stream-processor.ts` fires `onTaskUpdated(mapTask(finalRow))` where `finalRow` comes from an inline query that joins `conversations` but **not** `task_git_context`. The same gap exists in `human-turn-executor.ts` (3 call sites), `transition-executor.ts` (no-prompt path), and `retry-executor.ts`. Because the `TaskRow` type marks `worktree_path`, `worktree_status`, and `branch_name` as optional, missing them produces no type error — `mapTask()` silently maps the `undefined` fields to `null`, and the resulting `Task` is broadcast over WebSocket.

The frontend store (`taskStore`) unconditionally calls `_replaceTask()` on every `task.updated` event. After the replacement the stored task has `worktreePath: null`, so the `v-if="task.worktreePath"` gates on the Terminal and Code Server buttons evaluate to false.

The correct pattern already exists: `fetchTaskWithModel()` in `src/bun/db/task-queries.ts` performs `LEFT JOIN task_git_context gc ON gc.task_id = t.id` and is used in `transition-executor.ts` (with-prompt path), `code-review-executor.ts`, `orchestrator.ts`, and `task-git.ts`. The fix is to extend consistent usage to all remaining call sites.

## Goals / Non-Goals

**Goals:**
- All `onTaskUpdated` calls broadcast a `Task` object that always includes `worktreePath`, `worktreeStatus`, and `branchName` — even if they are null because no worktree exists yet
- Terminal and Code Server buttons remain visible after execution events without requiring a page refresh

**Non-Goals:**
- Changing the frontend store's replace semantics
- Changing the WebSocket push protocol or `task.updated` event shape
- Introducing any new query abstractions beyond using the existing `fetchTaskWithModel` helper

## Decisions

### Decision: Use `fetchTaskWithModel()` everywhere, not a new helper

`fetchTaskWithModel()` already returns the full `Task` projection including `task_git_context` fields. Introducing a new dedicated helper (e.g., `fetchTaskForBroadcast()`) would duplicate logic for no gain and create another abstraction to keep in sync.

*Alternatives considered*: Patching only the missing JOIN into each inline query — rejected because it scatters the correct query in multiple places and re-creates the maintenance problem.

### Decision: Replace all 6 call sites atomically

All sites feed `onTaskUpdated` (or the RPC return in `retry-executor`). Fixing them all at once prevents a partial fix where some events still null out worktree fields.

### Decision: No frontend changes

The `v-if="task.worktreePath"` guard in `TaskChatView.vue` is semantically correct — buttons should only appear when a worktree exists. The fix belongs in the backend broadcast path.

## Risks / Trade-offs

- **`fetchTaskWithModel()` is async** → all 6 call sites must `await` it. Because these are already inside `async` execution contexts, this is safe with no architectural change.
- **`fetchTaskWithModel()` returns `Task | null`** → callers must handle the null case. In practice `null` means the task row was deleted between execution end and the fetch, which is an acceptable no-op (skip the broadcast).
- **Slightly wider DB read on execution end** → adds one join per execution-end event. Given the existing join set in `fetchTaskWithModel`, the incremental cost is negligible.

## Open Questions

_(none — root cause and affected sites are fully confirmed)_
