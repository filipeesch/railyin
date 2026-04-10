## 1. Database

- [x] 1.1 Create migration for `task_todos` table with columns: `id` (integer, autoincrement), `task_id` (integer, FK), `title` (text), `status` (text, default `not-started`), `context` (text, nullable), `result` (text, nullable), `created_at`, `updated_at`
- [x] 1.2 Add DB query helpers: `createTodo`, `getTodoById`, `updateTodo`, `deleteTodo`, `listTodos` (id/title/status only) scoped by task_id

## 2. Tool Definitions

- [x] 2.1 Add `create_todo` tool definition to `TOOL_DEFINITIONS` in `tools.ts` (parameters: `title` required, `context` optional)
- [x] 2.2 Add `get_todo` tool definition (parameter: `id` required)
- [x] 2.3 Add `update_todo` tool definition (parameters: `id` required; `title`, `status`, `context`, `result` optional)
- [x] 2.4 Add `delete_todo` tool definition (parameter: `id` required)
- [x] 2.5 Add `list_todos` tool definition (no parameters)
- [x] 2.6 Register `todos` tool group in `TOOL_GROUPS` containing the five todo tools

## 3. Tool Execution

- [x] 3.1 Implement `create_todo` case in `executeTool` switch — insert row, return `{ id }`
- [x] 3.2 Implement `get_todo` case — fetch by id scoped to `toolCtx.taskId`, return full record or error string
- [x] 3.3 Implement `update_todo` case — partial update by id, return success or error string
- [x] 3.4 Implement `delete_todo` case — delete by id scoped to `toolCtx.taskId`, return success or error string
- [x] 3.5 Implement `list_todos` case — fetch all todos for `toolCtx.taskId`, return `[{ id, title, status }]`

## 4. System Injection

- [x] 4.1 In `compactMessages()` in `engine.ts`, after session notes injection: query todos for the current task and, if any exist, prepend a system message block with the formatted id/title/status list
- [x] 4.2 Format the injected block: header `## Active Todos`, each line `[{id}] {status-icon} {title}` (✓ completed, ● in-progress, ○ not-started)
- [x] 4.3 Ensure the todos block is omitted entirely when the task has no todos

## 5. Compaction Prompt Update

- [x] 5.1 Update `COMPACTION_SYSTEM_PROMPT` section 7 ("Pending Tasks") to instruct the model: if the todo system is active (a todo injection block was present), do not re-enumerate todos in prose — reference the todo system instead

## 6. RPC Handler

- [x] 6.1 Add `todos.list` RPC handler (read-only) that returns `[{ id, title, status }]` for a given `taskId`, for UI consumption
- [x] 6.2 Register the handler in the RPC router and add the relevant type to `rpc-types.ts`

## 7. UI — Collapsible Todo Panel

- [x] 7.1 Create `TodoPanel.vue` component that accepts a `taskId` prop, fetches todos via the `todos.list` RPC, and re-fetches after each AI turn completes
- [x] 7.2 Implement collapsed state: show `{completed} / {total} · Todos` in header, hidden when todo list is empty
- [x] 7.3 Implement expanded state: render each todo with status icon (✓ / ● / ○) and title
- [x] 7.4 Place `TodoPanel` above the chat message input in the task detail / chat view
- [x] 7.5 Wire up reactivity: subscribe to task execution events so the panel updates live as the model creates/updates todos during a run
