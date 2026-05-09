## 1. Types and interfaces

- [ ] 1.1 Add `"preparing"` to `ExecutionState` union type in `rpc-types.ts`
- [ ] 1.2 Create `IWorktreePreparerCallback` interface in `src/bun/git/WorktreeManager.ts`
- [ ] 1.3 Update `DBRow` types to support `preparing` state

## 2. WorktreeManager refactoring

- [ ] 2.1 Add `prepareAndExecute(...)` method to `WorktreeManager`
- [ ] 2.2 Implement callback-driven execution handoff in `WorktreeManager`
- [ ] 2.3 Remove `triggerWorktreeIfNeeded()`

## 3. Handler cleanup

- [ ] 3.1 Update `tasks.ts` handler to call `prepareAndExecute()` instead of `triggerWorktreeIfNeeded()`
- [ ] 3.2 Clean up worktree setup logic from `tasks.ts`
- [ ] 3.3 Update `BoardToolExecutor` to use new interface

## 4. State management

- [ ] 4.1 Update `resetStuckTasks()` to handle `"preparing"` state
- [ ] 4.2 Add system message for `"preparing"` state in `tasks.ts`
- [ ] 4.3 Wire up task state changes to `task.updated` service
