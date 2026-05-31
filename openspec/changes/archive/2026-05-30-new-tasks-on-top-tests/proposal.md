## Why

The `new-tasks-on-top` feature introduces new position arithmetic (`PositionService.getTopPosition`), changes how `tasks.create` assigns position, and adds explicit position logic to `BoardToolExecutor.execCreateTask`. None of these code paths have test coverage for their position behaviour. This change adds the missing unit, integration, and Playwright tests to verify correctness and prevent regressions.

## What Changes

- **`position-service.test.ts`**: new suite `PS-4` with 4 unit tests covering `getTopPosition` — non-empty column, empty column, single task, and cross-board isolation.
- **`handlers.test.ts`**: new `tasks.create` position sub-suite (`TC-POS`) with 4 integration tests verifying the created task's `position` field via in-memory DB.
- **`board-tool-executor.test.ts`**: two new cases under `BE-4` verifying that `execCreateTask` assigns a position less than the existing minimum (non-empty) and position 500 (empty backlog).
- **`board-create-task.spec.ts`**: two new Playwright tests (`CREATE-4`, `CREATE-5`) verifying DOM card order after UI creation and after an AI-created task arrives via WebSocket push.

## Capabilities

### New Capabilities

*(none — this change only adds tests, no new capabilities)*

### Modified Capabilities

- `position-service-tests`: add `PS-4` test suite covering the new `getTopPosition` method.
- `board-tool-executor-tests`: extend `BE-4` to verify position assignment on creation.
- `board-playwright-coverage`: extend `board-create-task.spec.ts` to verify card ordering after creation.

## Impact

- **Test files changed**: `src/bun/test/position-service.test.ts`, `src/bun/test/handlers.test.ts`, `src/bun/test/board-tool-executor.test.ts`, `e2e/ui/board-create-task.spec.ts`
- **Production code**: none
- **Dependencies**: requires `new-tasks-on-top` to be implemented first
