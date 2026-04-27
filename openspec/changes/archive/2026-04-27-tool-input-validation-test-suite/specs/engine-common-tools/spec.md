## MODIFIED Requirements

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All handlers in `common-tools.ts` and the tools files (`board-tools.ts`, `lsp-tools.ts`) SHALL accept `args: Record<string, unknown>` and cast to expected types internally. Tests SHALL pass typed values (not stringified values) when calling `executeCommonTool`.

The test migration SHALL:
- Replace `{ task_id: String(taskId) }` with `{ task_id: taskId }`
- Replace `{ number: "10" }` with `{ number: 10 }`
- Replace `{ items: JSON.stringify([...]) }` with `{ items: [...] }`
- Keep all existing pass/fail scenarios but update arg shapes

#### Scenario: Typed task_id passes handler without cast errors
- **WHEN** `executeCommonTool("get_task", { task_id: 42 }, ctx)` is called
- **THEN** the handler receives `42` as a number and returns the task

#### Scenario: Typed status passes update_todo_status handler
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "done" }, ctx)` is called
- **THEN** the handler updates the todo and returns confirmation

#### Scenario: Typed items array passes reorganize_todos handler
- **WHEN** `executeCommonTool("reorganize_todos", { items: [{ id: 1, number: 10 }] }, ctx)` is called
- **THEN** the handler uses the array directly without JSON.parse and updates ordering

### Requirement: update_todo_status rejects invalid status values via validation gate
The `update_todo_status` tool definition's `status` property SHALL have an explicit `enum` that the AJV gate enforces before the handler is ever invoked. Tests SHALL verify this integration.

#### Scenario: Invalid status returns error without DB write (integration)
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, ctx)` is called
- **THEN** the returned `text` MATCHES `/finished/` and the todo record is unchanged in the DB

#### Scenario: Valid status "deleted" passes gate
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "deleted" }, ctx)` is called
- **THEN** the validation gate passes and the handler soft-deletes the todo
