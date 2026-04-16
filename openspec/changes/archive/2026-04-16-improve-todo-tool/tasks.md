## 1. Database Migration

- [x] 1.1 Add migration `020_todo_v2` (or next available ID) to `src/bun/db/migrations.ts`: ALTER TABLE to add `number REAL NOT NULL DEFAULT 0` and `description TEXT NOT NULL DEFAULT ''` columns to `task_todos`
- [x] 1.2 In the same migration, UPDATE existing rows: set `status = 'pending'` where `status = 'not-started'`, set `status = 'done'` where `status = 'completed'`, and backfill `number` from id ordering (`UPDATE task_todos SET number = id`)
- [x] 1.3 Rewrite `src/bun/db/todos.ts` with new helpers: `createTodo(taskId, number, title, description)`, `editTodo(taskId, id, update)`, `deleteTodo(taskId, id)` (soft-delete via status), `getTodo(taskId, id)`, `listTodos(taskId)`, `reprioritizeTodos(taskId, items)` — update all TypeScript interfaces to match new schema

## 2. Shared RPC Types

- [x] 2.1 Update `TodoItem` interface in `src/shared/rpc-types.ts` to include `number: number`, `description: string`, and updated `status` union type (`pending | in-progress | done | blocked | deleted`)
- [x] 2.2 Add new RPC method signatures to `src/shared/rpc-types.ts`: `todos.get`, `todos.create`, `todos.edit`, `todos.delete` (in addition to updating `todos.list` response shape)

## 3. Common Tools — Tool Definitions

- [x] 3.1 Add `create_todo` to `COMMON_TOOL_DEFINITIONS` in `src/bun/engine/common-tools.ts` with ALWAYS/NEVER description: number (required REAL), title (required), description (required markdown memory). Return `{ id, number, title }`.
- [x] 3.2 Add `edit_todo` tool definition: id + any of `number`, `title`, `description`, `status`. At least one field required. Return `{ id, number, title }`.
- [x] 3.3 Add `delete_todo` tool definition: id only. Return `{ id, number, title }` of soft-deleted item.
- [x] 3.4 Add `list_todos` tool definition: no parameters. Returns array of `{ id, number, title }` (no description). ALWAYS/NEVER: ALWAYS call before editing to get current ids and numbers.
- [x] 3.5 Add `get_todo` tool definition: id required. Returns all fields including full description. ALWAYS/NEVER: ALWAYS call before editing a todo's description to see its current content.
- [x] 3.6 Add `reprioritize_todos` tool definition: accepts `items: [{id, number}]` array. Atomically updates numbers in a single transaction. Returns updated list.

## 4. Common Tools — Execution & Display

- [x] 4.1 Add all six todo cases to the `executeCommonTool` switch in `src/bun/engine/common-tools.ts`: call the new `src/bun/db/todos.ts` helpers, guard each with `if (!ctx.taskId)` error, return JSON strings
- [x] 4.2 Add display cases to `buildCommonToolDisplay` in `src/bun/engine/common-tools.ts`:
  - `create_todo` / `edit_todo`: label with number + title, content shows description markdown preview
  - `delete_todo`: label with number + title, no content
  - `list_todos` / `reprioritize_todos`: label "todo list", content is each item as `<number>  <title>` per line
  - `get_todo`: label with todo id
- [x] 4.3 Add todo tool names to `COMMON_TOOL_NAMES` set (automatic via `COMMON_TOOL_DEFINITIONS.map`)

## 5. Remove Todos from Native Engine

- [x] 5.1 Remove the `todos` tool group from the native engine tool definitions in `src/bun/workflow/tools.ts` (the `["todos", [...]]` entry and all four tool definition objects)
- [x] 5.2 Remove the `create_todo`, `update_todo`, `delete_todo`, `list_todos` cases from the `executeTool` switch in `src/bun/workflow/tools.ts`
- [x] 5.3 Remove the todo import from `workflow/tools.ts` (the `import { createTodo, ... } from "../db/todos.ts"` line)

## 6. RPC Handlers

- [x] 6.1 Update `todos.list` handler in `src/bun/handlers/tasks.ts` to return `number` and `status` fields alongside `id` and `title`; filter out `deleted` status by default
- [x] 6.2 Add `todos.get` handler: accepts `{ taskId, todoId }`, returns full todo record via `getTodo`
- [x] 6.3 Add `todos.create` handler: accepts `{ taskId, number, title, description }`, returns `{ id, number, title }`
- [x] 6.4 Add `todos.edit` handler: accepts `{ taskId, todoId, ...updates }`, returns updated `{ id, number, title }`
- [x] 6.5 Add `todos.delete` handler: accepts `{ taskId, todoId }`, soft-deletes and returns `{ id, number, title }`

## 7. UI — TodoPanel Updates

- [x] 7.1 Update `TodoPanel.vue` to use the new `TodoItem` fields (`number`, `description`, updated status values); update status icons for `blocked` (⊘) and `deleted` (hidden)
- [x] 7.2 Add per-item delete button (`✕`) to each todo row in `TodoPanel.vue`; clicking it calls `todos.delete` RPC and removes the item from the list
- [x] 7.3 Add "+" button to `TodoPanel` header; clicking it opens `TodoDetailOverlay` in create mode
- [x] 7.4 Make todo items clickable — clicking the title opens `TodoDetailOverlay` in view/edit mode

## 8. UI — TodoDetailOverlay Component

- [x] 8.1 Create `src/mainview/components/TodoDetailOverlay.vue` — non-fullscreen panel overlay following existing overlay patterns (`WorkflowEditorOverlay.vue`)
- [x] 8.2 Implement overlay header: editable `number` (small number input) and editable `title` (text input), delete button (✕), close button
- [x] 8.3 Implement description display: markdown preview mode (using existing markdown rendering pattern in the codebase), toggle button to switch to edit mode (textarea)
- [x] 8.4 Implement Save/Cancel buttons: Save calls `todos.edit` or `todos.create` RPC, Cancel discards changes and closes; confirm discard if unsaved changes
- [x] 8.5 Wire overlay to TodoPanel: emit `open-todo` event from TodoPanel, handle in parent to open overlay with the selected todo's data; emit `todo-created` / `todo-updated` / `todo-deleted` events back to trigger list refresh
