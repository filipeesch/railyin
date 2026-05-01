## 1. Test Infrastructure: Schema + Constructor Updates

- [x] 1.1 Add `needs_column_prompt INTEGER NOT NULL DEFAULT 0` to the inline `CREATE TABLE tasks (...)` in `src/bun/test/helpers.ts` (after the `created_at` column, ~line 46)
- [x] 1.2 Update all 6 `new StreamProcessor(db, fakeRawBuffer, noop, noop, noop, noop)` calls in `src/bun/test/stream-processor.test.ts` to add two trailing `, noop` args (SP-1 through SP-6 must still pass)
- [x] 1.3 Update `StubStreamProcessor` in `src/bun/test/transition-executor.test.ts` — change `super(null as never, fakeRawBuffer, ()=>{}, ()=>{}, ()=>{}, ()=>{})` to add two more `() => {}` no-ops

## 2. Backend Tests: Badge Fix

- [x] 2.1 In `src/bun/test/transition-executor.test.ts`, add **TE-BADGE**: after `transitionExecutor.execute()` returns, assert `result.task.executionState === 'running'` (not stale `'idle'`)

## 3. Backend Tests: StreamProcessor Drain

- [x] 3.1 In `src/bun/test/stream-processor.test.ts`, add **SP-7**: task with `needs_column_prompt = 1` → `onDeferredTransition` spy called with `(taskId, workflow_state)`, flag cleared to `0` in DB
- [x] 3.2 Add **SP-8**: task with `pending_messages` rows and `needs_column_prompt = 0` → `onPendingMessage` spy called per row, all rows deleted from DB
- [x] 3.3 Add **SP-9**: neither flag nor pending rows → neither spy called, only `onTaskUpdated` fires
- [x] 3.4 Add **SP-10**: `needs_column_prompt = 1` AND `pending_messages` rows → only `onDeferredTransition` fires; `onPendingMessage` spy NOT called

## 4. Backend Tests: execMoveTask Three-Case Logic

- [x] 4.1 In `src/bun/test/tasks-tools.test.ts`, add **MT-A1**: self-move (`ctx.taskId === movedTaskId`) to column with `on_enter_prompt` → `needs_column_prompt = 1` in DB, `onTransition` spy NOT called
- [x] 4.2 Add **MT-A2**: cross-task move of a task with `execution_state = 'running'` to column with `on_enter_prompt` → flag = 1, spy NOT called
- [x] 4.3 Add **MT-B1**: cross-task move of idle task to column with `on_enter_prompt` → `onTransition` spy called with `(movedTaskId, targetState)`, flag = 0
- [x] 4.4 Add **MT-C1**: move any task to column without `on_enter_prompt` → flag = 0, spy NOT called

## 5. Backend Tests: tasks.transition Deferred Handler

- [x] 5.1 In `src/bun/test/handlers.test.ts`, add `describe('tasks.transition / running task deferred')` with **TH-DEFER-1**: set `execution_state = 'running'` directly in DB, call `tasks.transition` targeting a column with `on_enter_prompt` → assert `workflow_state` updated, `needs_column_prompt = 1`, response `executionId: null`, `execution_state` still `'running'`
- [x] 5.2 Add **TH-DEFER-2**: same setup, column without `on_enter_prompt` → `workflow_state` updated, `needs_column_prompt = 0`, `executionId: null`

## 6. Frontend Tests: Unread Dot Logic

- [x] 6.1 In `src/mainview/stores/task.test.ts`, add **T10**: `onTaskUpdated` with `kind='execution'`, `nextState='completed'`, non-active task → `unreadTaskIds` contains task id
- [x] 6.2 Add **T11**: `onTaskUpdated` with `kind='execution'`, `nextState='running'` → `unreadTaskIds` does NOT contain task id
- [x] 6.3 Add **T12**: `onTaskUpdated` with `kind='workflow'`, non-active task → `unreadTaskIds` does NOT contain task id
- [x] 6.4 Add **T13**: `onTaskUpdated` with `kind='execution'`, `nextState='completed'`, IS active task → `unreadTaskIds` does NOT contain task id
- [x] 6.5 Add **T14**: `onTaskStreamEvent` with `assistant` event for non-active task → `unreadTaskIds` does NOT contain task id
- [x] 6.6 Add **T15**: `onTaskNewMessage` with assistant message for non-active task → `unreadTaskIds` does NOT contain task id
- [x] 6.7 Add **T16**: `onTaskUpdated` with `kind='execution'`, `nextState='waiting_user'` → `unreadTaskIds` contains task id

## 7. Playwright Tests: Fix Breaking Tests

- [x] 7.1 In `e2e/ui/board-unread.spec.ts`, update **UNREAD-1** — replace `ws.push({ type: 'message.new', ... })` trigger with `ws.push({ type: 'task.updated', payload: { ...task, executionState: 'completed' } })`
- [x] 7.2 Update **UNREAD-3** — same trigger replacement (workspace tab unread dot test)
- [x] 7.3 Update **UNREAD-4** — same trigger replacement in the setup step before the "user opens task" assertion

## 8. Playwright Tests: New Unread Tests

- [x] 8.1 Add **UNREAD-5**: `task.updated` with `executionState: 'completed'` for non-active task → unread dot visible on card
- [x] 8.2 Add **UNREAD-6**: `task.updated` with `executionState: 'running'` for non-active task → unread dot NOT visible
- [x] 8.3 Add **UNREAD-7**: `task.updated` with `workflowState` change only (no `executionState` change) → unread dot NOT visible

## 9. Playwright Tests: Deferred Prompt Flows

- [x] 9.1 In `e2e/ui/board-dnd.spec.ts` or new `e2e/ui/queued-column-prompt.spec.ts`, add **DND-RUNNING-1**: push `task.updated` with `executionState: 'running'`, drag card to prompt column → card in target column, badge shows `Running`
- [x] 9.2 Add **DRAWER-DEFER-1**: open task drawer for running task, select prompt column from dropdown → mock API returns `{ executionId: null }`, badge stays `Running`, card is in new column
