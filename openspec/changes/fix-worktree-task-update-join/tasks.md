## 1. Fix broadcast queries

- [ ] 1.1 In `stream-processor.ts`: replace the inline `SELECT t.*, c.model` query (used to build the `task.updated` broadcast after execution end) with `await fetchTaskWithModel(db, taskId)`, adding the import if not present and handling the null case
- [ ] 1.2 In `human-turn-executor.ts` (~line 70): replace inline query for the `waiting_user` path with `await fetchTaskWithModel(db, taskId)`
- [ ] 1.3 In `human-turn-executor.ts` (~line 113): replace inline query for the engine-session-lost fallback path with `await fetchTaskWithModel(db, taskId)`
- [ ] 1.4 In `human-turn-executor.ts` (~line 168): replace inline query for the new-execution start path with `await fetchTaskWithModel(db, taskId)`
- [ ] 1.5 In `transition-executor.ts` (~line 77): replace inline query for the no-prompt path return value with `await fetchTaskWithModel(db, taskId)`
- [ ] 1.6 In `retry-executor.ts` (~line 109): replace the `updatedRow`-based task return with `await fetchTaskWithModel(db, taskId)`

## 2. Verify

- [ ] 2.1 Confirm `fetchTaskWithModel` is correctly imported (or add the import) in each modified file
- [ ] 2.2 Run backend test suite (`bun test src/bun/test --timeout 20000`) and confirm no regressions
