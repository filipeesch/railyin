## MODIFIED Requirements

### Requirement: Common tool handlers accept typed Record<string, unknown> args
All common tool handlers — including those in `board-tools.ts`, `lsp-tools.ts`, and `common-tools.ts` — SHALL accept `args: Record<string, unknown>` instead of `Record<string, string>`. Handlers SHALL cast to the expected type after AJV validation has confirmed the value is safe (e.g. `args.task_id as number`). The `toToolArgs()` serialisation helper SHALL be removed from both `engine/claude/tools.ts` and `engine/copilot/tools.ts`.

The test suite for `executeCommonTool` SHALL pass typed values (e.g. `{ task_id: 42 }` not `{ task_id: "42" }`) for all numeric, boolean, and array fields. Passing a string where a number is expected SHALL produce a validation error (not silently succeed).

#### Scenario: Typed numeric arg passes to handler correctly
- **WHEN** `executeCommonTool("get_task", { task_id: 42 }, commonCtx())` is called
- **THEN** the handler receives `42` as a number and returns the task successfully

#### Scenario: String-typed numeric arg is rejected by validation
- **WHEN** `executeCommonTool("get_task", { task_id: "42" }, commonCtx())` is called
- **THEN** `executeCommonTool` returns a validation error mentioning `task_id` type mismatch

#### Scenario: update_todo_status with valid typed status succeeds
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "done" }, commonCtx())` is called
- **THEN** the todo is updated and the handler returns a success message

#### Scenario: update_todo_status with invalid status is rejected
- **WHEN** `executeCommonTool("update_todo_status", { id: 1, status: "finished" }, commonCtx())` is called
- **THEN** `executeCommonTool` returns an error naming `"finished"` and listing valid values

#### Scenario: reorganize_todos with real array succeeds
- **WHEN** `executeCommonTool("reorganize_todos", { items: [{ id: 1, number: 10 }] }, commonCtx())` is called
- **THEN** the handler processes the array without JSON.parse and returns the updated todo list
