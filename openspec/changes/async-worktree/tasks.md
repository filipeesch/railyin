## 1. Types and interfaces

- [x] 1.1 Add `"preparing"` to `ExecutionState` union type in `rpc-types.ts`
- [x] 1.2 Create `IWorktreePreparerCallback` interface in `src/bun/git/WorktreeManager.ts`
- [ ] 1.3 Update `DBRow` types to support `preparing` state

## 2. WorktreeManager refactoring

- [x] 2.1 Add `prepareAndExecute(...)` method to `WorktreeManager`
- [x] 2.2 Implement callback-driven execution handoff in `WorktreeManager`
- [ ] 2.3 Remove `triggerWorktreeIfNeeded()` — needs review for removal

## 3. Handler cleanup

- [x] 3.1 Update `tasks.ts` handler to call `prepareAndExecute()` instead of `triggerWorktreeIfNeeded()`
- [x] 3.2 Clean up worktree setup logic from `tasks.ts`
- [x] 3.3 Update `BoardToolExecutor` to use new interface
- [x] 3.4 Re-export `IWorktreePreparerCallback` from `handlers/tasks.ts` for consumers
- [x] 3.5 Fix `IWorktreePreparerCallback` `onFailed` return type to `void`
- [x] 3.6 Update callback signatures in `tasks.ts` to use `prepareAndExecute` method
- [x] 3.7 Fix `tasks.retry` handler to use `prepareAndExecute` callback pattern
- [x] 3.8 Add Return type to simulate integration test
- [x] 3.9 Update dummy test to use `callback` object with `prepareAndExecute` method
- [x] 3.10 Fix `worktree.test.ts` to use `IWorktreePreparerCallback` interface

## 4. State management

- [x] 4.1 Update `resetStuckTasks()` to handle `"preparing"` state
- [x] 4.2 Add system message for `"preparing"` state in `tasks.ts`
- [x] 4.3 Wire up task state changes to `task.updated` service

## Implementation Summary

- `IWorktreePreparerCallback` interface defined with `executeTask()` and `onFailed()` methods
- `prepareAndExecute()` method implemented in `WorktreeManager` to async worktree creation
- `tasks.transition` and `tasks.retry` handlers updated to use `prepareAndExecute` callback pattern
- Tests pass and TypeScript compilation is clean
- Changes committed and pushed to `task/402-async-worktree` branch
