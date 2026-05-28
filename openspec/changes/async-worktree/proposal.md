# Async Worktree Preparation

## Why

Task transitions block for 1–5 seconds while a git worktree is created synchronously. This blocks the RPC request, delays execution start, and creates a poor UX. Making worktree creation async allows immediate feedback while the worktree is prepared in the background.

## What Changes

- New `"preparing"` execution state: `idle → preparing → running`
- `WorktreeManager.prepareAndExecute()` replaces `triggerWorktreeIfNeeded()` entirely
- Callback interface (`IWorktreePreparerCallback`) for execution handoff
- Handler cleanup: `tasks.ts` no longer contains git context / worktree setup logic
- Concurrent `prepareAndExecute()` calls are idempotent — single concurrent protection per task
- Server restart protection — `"preparing"` state resumes background task if server restarts mid-preparation
- `resetStuckTasks()` handles `"preparing"` state — treats it as `"failed"` on server restart
- `needs_column_prompt` flag stays unchanged — it's a flag for when execution_start is needed (orthogonal to "preparing")

## Capabilities

### New Capabilities
- `async-worktree-preparation`: Async worktree creation with `preparing` state and callback-driven execution handoff

### Modified Capabilities
- `task-transition`: Worktree creation no longer blocks transitions

## Impact

**Code**: `WorktreeManager.ts`, `rpc-types.ts` (`ExecutionState` union), `ITaskGitContextRepository.ts`, `BoardToolExecutor.ts`, notification service
**API**: New `preparing` state in task lifecycle
**Dependencies**: No new libraries required — existing DI infrastructure fully supports the changes
**Schema**: No migration required — `execution_state` is a SQLite TEXT column, `"preparing"` is a new string value
**Edge cases**: Concurrent `prepareAndExecute()` calls are idempotent (concurrent cleanup); server restarts resume worktree creation from `"preparing"` state
