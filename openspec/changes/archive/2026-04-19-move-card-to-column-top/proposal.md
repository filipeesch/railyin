## Why

When a user moves a card to a different column using the workflow Select dropdown (in the Task Detail Drawer), the card lands at an unpredictable position in the target column — it keeps its old `position` value from the source column, which may place it anywhere. The same issue affects AI agent `move_task` calls. Cards should always land at the **top** of the target column, making the result predictable and consistent with common kanban tool behavior.

## What Changes

- When transitioning a task via the **Select dropdown** in `TaskDetailDrawer`, compute a `targetPosition` that places the card at the top of the destination column before calling `transitionTask`.
- When the **AI agent `move_task` tool** moves a task, automatically compute and set a top-of-column position in the same DB update step.
- When `tasks.transition` RPC is called **without** a `targetPosition`, the backend defaults to placing the card at the top of the target column (belt-and-suspenders, covers future callers).

## Capabilities

### New Capabilities

- `card-column-placement`: Defines the placement rule for cards moved between columns — cards always land at the top of the destination column when moved via the Select UI or agent `move_task` tool.

### Modified Capabilities

- `board`: The existing transition requirement gains a placement sub-requirement — when a task is moved to a new column, it appears at the **top** of that column.

## Impact

- `src/mainview/components/TaskDetailDrawer.vue` — `transition()` function: read target column tasks from store, compute top position, pass to `transitionTask`.
- `src/bun/workflow/tools.ts` — `move_task` case: query `MIN(position)` of target column, set position to `minPos / 2` (500 if empty) in the same `UPDATE`.
- `src/bun/handlers/tasks.ts` — `tasks.transition` handler: when `targetPosition` is absent, query and compute top-of-column position before the state update.
- No API surface changes. No new dependencies.
