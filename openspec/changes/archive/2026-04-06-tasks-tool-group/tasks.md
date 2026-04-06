## 1. Tool Definitions

- [x] 1.1 Add `get_task` tool definition to `TOOL_DEFINITIONS` in `tools.ts` with `task_id` (required) and `include_messages` (optional number) params
- [x] 1.2 Add `get_board_summary` tool definition with optional `board_id` param
- [x] 1.3 Add `list_tasks` tool definition with optional `board_id`, `workflow_state`, `execution_state`, `project_id`, `query`, and `limit` params
- [x] 1.4 Add `create_task` tool definition with required `project_id`, `title`, `description` and optional `board_id`, `model` params
- [x] 1.5 Add `edit_task` tool definition with required `task_id` and at least one of `title`, `description`
- [x] 1.6 Add `delete_task` tool definition with required `task_id`
- [x] 1.7 Add `move_task` tool definition with required `task_id` and `workflow_state`

## 2. Tool Groups Registration

- [x] 2.1 Add `tasks_read` entry to `TOOL_GROUPS` map: `["get_task", "get_board_summary", "list_tasks"]`
- [x] 2.2 Add `tasks_write` entry to `TOOL_GROUPS` map: `["create_task", "edit_task", "delete_task", "move_task"]`

## 3. Tool Context

- [x] 3.1 Extend `ToolContext` interface in `tools.ts` to include `taskId?: number`, `boardId?: number`, and `taskCallbacks?: TaskToolCallbacks` (engine-injected callbacks to avoid circular imports)

## 4. Read Tool Implementations

- [x] 4.1 Implement `get_task` executor: query DB with `fetchTaskWithDetail`, optionally fetch last N messages from conversation ordered by `created_at DESC LIMIT N` then reverse
- [x] 4.2 Implement `get_board_summary` executor: query tasks grouped by `workflow_state` and `execution_state` for the target board; return structured JSON summary
- [x] 4.3 Implement `list_tasks` executor: build parameterised SQL query with optional WHERE clauses for `workflow_state`, `execution_state`, `project_id`, and LIKE on `title`/`description` for `query`; apply `LIMIT` (default 50, max 200)

## 5. Write Tool Implementations

- [x] 5.1 Implement `create_task` executor: reuse `tasks.create` handler logic (create conversation, insert task row, trigger worktree if needed); use `ctx.boardId` when `board_id` param omitted
- [x] 5.2 Implement `edit_task` executor: check `worktree_status` — return error if `creating` or `ready`; otherwise update `title`/`description` and return updated task
- [x] 5.3 Implement `delete_task` executor: call `cancelExecution` callback if `execution_state === 'running'`, then run the same cascade delete used by the UI handler (messages → executions → git_context → pending_messages → conversation → task)
- [x] 5.4 Implement `move_task` executor: validate `workflow_state` exists in board template; update `workflow_state` in DB; call `handleTransition` callback fire-and-forget

## 6. Engine Integration

- [x] 6.1 Pass `taskId`, `boardId`, and `taskCallbacks` into `ToolContext` when building the context in `runExecution`; `toolCtx` is now always non-null (board tools don't need a worktree)
- [x] 6.2 Add a post-tool-call guard after `delete_task`: check if the current task still exists in the DB; if not, clean up the execution controller and return

## 7. Tests

- [x] 7.1 Unit test `get_task`: returns task metadata; returns last N messages in chronological order; errors on unknown id
- [x] 7.2 Unit test `get_board_summary`: returns correct counts per column and execution_state
- [x] 7.3 Unit test `list_tasks`: no filter returns all; filter by `workflow_state`; filter by `query`
- [x] 7.4 Unit test `create_task`: task created in backlog; `board_id` defaults to current board; `model` field stored
- [x] 7.5 Unit test `edit_task`: updates when `worktree_status = not_created`; returns error when `worktree_status = ready`
- [x] 7.6 Unit test `delete_task`: cascade removes all records; running task calls cancelExecution callback
- [x] 7.7 Unit test `move_task`: `workflow_state` updated immediately; unknown column returns error; `handleTransition` callback fired
- [x] 7.8 Unit test `TOOL_GROUPS`: `tasks_read` and `tasks_write` registered correctly; `message_task` in `tasks_write`
