## Why

Todo items are currently injected into every AI execution regardless of the task's current board column, creating noise when a task has todos planned for future columns. There's also no way for the model or user to signal that a given todo belongs to a specific phase of work (e.g., "this is a review-phase todo, not a coding-phase todo").

## What Changes

- Add `phase TEXT NULL` column to `task_todos`. NULL means the todo is always active (column-agnostic).
- System injection of todos is filtered to `phase IS NULL OR phase = current_workflow_state` — future- and past-phase todos are not sent to the model, reducing context noise.
- The `create_todo` and `edit_todo` AI tools accept an optional `phase` parameter.
- The `list_todos` AI tool returns `phase` per item (no filtering — the model always sees the full picture when querying explicitly).
- The `TodoPanel` UI visually mutes (fades + italic + column badge) any todo whose phase doesn't match the task's current workflow state, including both past-phase and future-phase todos.
- The `TodoDetailOverlay` gains a Phase dropdown listing board column names plus a "— any phase —" option.
- RPC `todos.create` and `todos.edit` accept `phase`; `todos.list` and `todos.get` return it.

## Capabilities

### New Capabilities

_(none — this is a focused enhancement to an existing capability)_

### Modified Capabilities

- `task-todo-tool`: Phase scoping added to todo schema, tools, system injection, RPC, and UI overlay.

## Impact

- DB: additive migration — `ALTER TABLE task_todos ADD COLUMN phase TEXT NULL`
- `src/bun/db/todos.ts`: `TodoItem`, `TodoListItem`, `TodoUpdate` gain `phase`; `listTodos()` gains optional `currentPhase` param; `createTodo()` and `editTodo()` accept phase.
- `src/shared/rpc-types.ts`: `TodoItem`, `TodoListItem` gain `phase`; `todos.create` and `todos.edit` params gain `phase`.
- `src/bun/engine/common-tools.ts`: tool definitions and handlers updated for `create_todo`, `edit_todo`, `list_todos`.
- `src/bun/workflow/engine.ts`: system injection call passes `task.workflow_state` as `currentPhase` filter.
- `src/mainview/components/TodoPanel.vue`: receives `workflowState` and `boardId` props; renders muted state with phase badge.
- `src/mainview/components/TodoDetailOverlay.vue`: receives `boardId` prop, fetches board columns, shows Phase dropdown.
- `src/mainview/components/TaskDetailDrawer.vue`: threads `boardId` and `workflowState` down to `TodoPanel`.
- No breaking changes to existing callers — `phase` is additive and optional everywhere.
