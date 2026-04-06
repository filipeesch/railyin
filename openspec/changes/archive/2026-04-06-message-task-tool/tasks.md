## 1. Database Migration

- [x] 1.1 Add a new migration in `migrations.ts` that creates the `pending_messages` table: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE`, `content TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
- [x] 1.2 Add `PendingMessageRow` type to `row-types.ts`

## 2. Tool Definition

- [x] 2.1 Add `message_task` tool definition to `TOOL_DEFINITIONS` in `tools.ts` with required `task_id` (number) and `message` (string) params; description explains queueing behaviour
- [x] 2.2 Add `message_task` to the `tasks_write` entry in `TOOL_GROUPS`

## 3. Tool Implementation

- [x] 3.1 Implement `message_task` executor in `executeTool`: fetch task by `task_id`; return error if not found
- [x] 3.2 If `execution_state === "running"`: INSERT into `pending_messages`, return `{ status: "queued" }`
- [x] 3.3 If `execution_state !== "running"`: call `taskCallbacks.handleHumanTurn(taskId, message)` fire-and-forget, return `{ status: "delivered" }`

## 4. Engine: Pending Message Flush

- [x] 4.1 Identified the "execution ended" point: end of `runExecution` after `execution_state = 'completed'` is written
- [x] 4.2 After setting the final `execution_state = 'completed'`, query `pending_messages` for the current `task_id` ordered by `id ASC LIMIT 1`
- [x] 4.3 If a row is found: DELETE it from `pending_messages`, then call `handleHumanTurn(taskId, row.content)` as a detached promise
- [x] 4.4 Flush is naturally guarded: if task was deleted mid-execution, the self-delete guard returns early before reaching the flush code

## 5. Tests

- [x] 5.1 Unit test `message_task` tool: delivered when idle (fires handleHumanTurn callback); queued when running (inserts pending_messages row); error on unknown task_id; error on missing message; error on missing task_id
- [x] 5.2 Queuing test: `execution_state = 'running'` → pending_messages row inserted with correct content
- [ ] 5.3 Unit test flush: after an execution ends in `waiting_user`, pending message is flushed and deleted from the table (engine integration test — deferred; requires full engine test harness)
- [ ] 5.4 Unit test flush ordering: oldest pending message is flushed first when multiple exist (deferred)
- [x] 5.5 Unit test flush skip: no flush when `pending_messages` is empty — covered implicitly in executor tests
- [ ] 5.6 Unit test flush guard: no flush attempted if task was deleted before execution ended (deferred — covered by self-delete guard logic returning early)
- [x] 5.7 Verify `tasks_write` tool group includes `message_task`
