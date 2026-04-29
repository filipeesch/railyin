## 1. New Utility

- [x] 1.1 Create `src/bun/engine/execution/model-resolver.ts` with `resolveTaskModel(columnModel, taskModel, engineConfig): string`

## 2. Task Creation Fix

- [x] 2.1 Update `tasks.create` handler in `src/bun/handlers/tasks.ts` to seed `task.model = engine.model` when `engine.model` is set

## 3. Executor Fixes

- [x] 3.1 Update `TransitionExecutor` to call `resolveTaskModel()` instead of inline `column?.model ?? task.model ?? ""`
- [x] 3.2 Update `HumanTurnExecutor` to use `resolveTaskModel()` and write resolved model back to DB when task model was null
- [x] 3.3 Update `RetryExecutor` to use `resolveTaskModel()` and write resolved model back to DB when task model was null
