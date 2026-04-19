## 1. Backend: tasks.transition RPC

- [x] 1.1 In `tasks.transition` handler (`src/bun/handlers/tasks.ts`), when `targetPosition` is absent, query `SELECT MIN(position) FROM tasks WHERE board_id = ? AND workflow_state = ?` for the target column and set position to `MIN / 2` (or `500` if null), then apply it before the state transition

## 2. Backend: move_task agent tool

- [x] 2.1 In the `move_task` case of `executeTool` (`src/bun/workflow/tools.ts`), query `SELECT MIN(position) FROM tasks WHERE board_id = ? AND workflow_state = ?` for the target column and include `position = ?` in the `UPDATE tasks SET workflow_state = ?, position = ?` statement

## 3. Frontend: Select dropdown transition

- [x] 3.1 In `TaskDetailDrawer.vue` `transition()`, read the target column's tasks from `taskStore.tasksByBoard`, compute `topPosition = firstCard.position / 2` (or `500` if empty), and pass it as the third argument to `taskStore.transitionTask(task.value.id, toState, topPosition)`

## 4. Verification

- [x] 4.1 Write and run e2e tests for card-column-placement
