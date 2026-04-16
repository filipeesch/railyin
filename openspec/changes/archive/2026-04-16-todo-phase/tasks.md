## 1. DB Layer

- [x] 1.1 Add migration `025_todo_phase`: `ALTER TABLE task_todos ADD COLUMN phase TEXT NULL`
- [x] 1.2 Add `phase: string | null` to `TodoItem`, `TodoListItem`, and `TodoUpdate` interfaces in `src/bun/db/todos.ts`
- [x] 1.3 Update `mapTodoRow()` to map `row.phase` to the returned `TodoItem`
- [x] 1.4 Update `createTodo()` to accept an optional `phase?: string | null` parameter and include it in the INSERT
- [x] 1.5 Update `editTodo()` to handle `update.phase` in the dynamic SET clause
- [x] 1.6 Update `listTodos()` to accept an optional `currentPhase?: string` parameter; when provided, append `AND (phase IS NULL OR phase = ?)` to the SQL query

## 2. Shared Types & RPC

- [x] 2.1 Add `phase: string | null` to `TodoItem` and `TodoListItem` in `src/shared/rpc-types.ts`
- [x] 2.2 Add optional `phase?: string` to `todos.create` RPC params in `rpc-types.ts`
- [x] 2.3 Add optional `phase?: string | null` to `todos.edit` RPC params in `rpc-types.ts`
- [x] 2.4 Update `todos.create` RPC handler (in `src/bun/handlers/tasks.ts` or equivalent) to pass `phase` to `createTodo()`
- [x] 2.5 Update `todos.edit` RPC handler to pass `phase` to `editTodo()`

## 3. AI Tools

- [x] 3.1 Add optional `phase` string parameter to the `create_todo` tool definition in `src/bun/engine/common-tools.ts`; description SHALL explain it scopes the todo to a specific workflow state id and that omitting it makes the todo always active
- [x] 3.2 Add optional `phase` string parameter to the `edit_todo` tool definition; description SHALL note passing null clears the phase
- [x] 3.3 Update `list_todos` tool description to note that `phase` is returned per item and that the tool always returns all non-deleted todos (no phase filtering)
- [x] 3.4 Update `create_todo` tool handler to read `args.phase` and pass it to `createTodo()`
- [x] 3.5 Update `edit_todo` tool handler to read `args.phase` and include it in the `update` object passed to `editTodo()`

## 4. System Injection

- [x] 4.1 In `src/bun/workflow/engine.ts`, update the `listTodos(taskId)` call in the system injection block to `listTodos(taskId, false, task.workflow_state)` so that only phase-active todos are injected

## 5. Frontend — Prop Threading

- [x] 5.1 In `TaskDetailDrawer.vue`, pass `:board-id="task.boardId"` and `:workflow-state="task.workflowState"` props to `TodoPanel`
- [x] 5.2 In `TodoPanel.vue`, declare `boardId: number` and `workflowState: string` props and pass `:board-id="boardId"` to `TodoDetailOverlay`

## 6. Frontend — TodoPanel Muted State

- [x] 6.1 In `TodoPanel.vue`, add an `isMuted(todo)` helper: returns `true` when `todo.phase && todo.phase !== workflowState`
- [x] 6.2 Apply `todo-panel__item--muted` CSS class to muted items (opacity 0.45, font-style italic on the title)
- [x] 6.3 Render a small phase badge (`<span class="todo-panel__phase-badge">{{ todo.phase }}</span>`) on muted items only

## 7. Frontend — TodoDetailOverlay Phase Dropdown

- [x] 7.1 Add `boardId: number` prop to `TodoDetailOverlay.vue`
- [x] 7.2 Add `boardColumns` ref and fetch logic: on mount, call `boards.list()`, find the board by `boardId`, extract `template.columns`
- [x] 7.3 Add `phase: string | null` to the `form` reactive object (default `null`)
- [x] 7.4 Add a Phase `<select>` field in the overlay header/body with "— any phase —" (value null) + one `<option>` per column (`value: column.id`, label: `column.label`)
- [x] 7.5 Populate `form.phase` from the loaded todo in `loadTodo()`
- [x] 7.6 Include `phase: form.phase || null` in both `todos.create` and `todos.edit` calls in `onSave()`

## 8. Tests

- [x] 8.1 Add unit tests for `listTodos()` with `currentPhase` param — verify filtered and unfiltered results
- [x] 8.2 Add unit tests for `createTodo()` and `editTodo()` with `phase` field — verify persistence and retrieval
- [x] 8.3 Update existing AI tool tests in `src/bun/test/tasks-tools.test.ts` to assert `phase` is returned by `list_todos` and accepted by `create_todo` / `edit_todo`
