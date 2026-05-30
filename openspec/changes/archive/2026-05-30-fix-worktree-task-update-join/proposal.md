## Why

When any execution completes (or starts), `onTaskUpdated` broadcasts a `Task` object built from SQL queries that are missing the `LEFT JOIN task_git_context` join — causing `worktreePath`, `worktreeStatus`, and `branchName` to be null in the WebSocket push. The frontend store unconditionally replaces its cached task with the incoming payload, so the terminal and code-editor buttons disappear until the user refreshes. The fix is already prepared: `fetchTaskWithModel()` in `task-queries.ts` includes the correct join and is used in some call sites — it just needs to be applied consistently everywhere.

## What Changes

- Replace 5 inline `SELECT t.*, c.model` queries (missing the git-context join) that feed `onTaskUpdated` calls in `stream-processor.ts`, `human-turn-executor.ts`, and `transition-executor.ts` with calls to `fetchTaskWithModel()`
- Replace the task returned from `retry-executor.ts` (built from an incomplete row) with `fetchTaskWithModel()`
- No API changes, no schema changes, no new dependencies

## Capabilities

### New Capabilities
_(none — this is a pure bug fix)_

### Modified Capabilities
_(none — the existing `git-worktree` and `task-execution-state-sync` specs already require worktree fields to be present on pushed task objects; this change makes the implementation match those requirements)_

## Impact

- **Modified files**: `src/bun/engine/stream/stream-processor.ts`, `src/bun/engine/execution/human-turn-executor.ts`, `src/bun/engine/execution/transition-executor.ts`, `src/bun/engine/execution/retry-executor.ts`
- No API contract changes
- No DB schema changes
- No frontend changes required
