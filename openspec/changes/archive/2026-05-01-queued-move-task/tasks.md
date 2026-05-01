## 1. DB Migration

- [x] 1.1 Create `src/bun/db/migrations/034_needs_column_prompt.ts` with `ALTER TABLE tasks ADD COLUMN needs_column_prompt INTEGER NOT NULL DEFAULT 0`
- [x] 1.2 Add `needs_column_prompt: number` field to `TaskRow` interface in `src/bun/db/row-types.ts`

## 2. Bug Fix: Status Badge (TransitionExecutor)

- [x] 2.1 In `src/bun/engine/execution/transition-executor.ts`, re-read the task row after writing `execution_state = 'running'` and use the fresh `runningRow` as the return value instead of the stale `updatedRow`

## 3. ExecutionParams: onTransition + onHumanTurn

- [x] 3.1 Add `onTransition?: (taskId: number, toState: string) => void` and `onHumanTurn?: (taskId: number, message: string) => void` to `ExecutionParams` in `src/bun/engine/types.ts`
- [x] 3.2 In `src/bun/engine/claude/engine.ts`, wire `commonToolContext.onTransition = params.onTransition ?? (() => {})` and same for `onHumanTurn`
- [x] 3.3 In `src/bun/engine/copilot/engine.ts`, same wiring for both callbacks from params into `commonToolContext`
- [x] 3.4 In `src/bun/engine/orchestrator.ts`, build `onTransition` as `(tid, state) => void this.transitionExecutor.execute(tid, state)` and `onHumanTurn` as `(tid, msg) => void this.humanTurnExecutor.execute(tid, msg)` and pass both when constructing `ExecutionParams`

## 4. execMoveTask: Three-Case Logic

- [x] 4.1 In `src/bun/workflow/tools/board-tools.ts` `execMoveTask`, compute `isSelf`, `isRunning`, `hasPrompt` using the target task's `execution_state` and the target column's `on_enter_prompt` from workflow config
- [x] 4.2 Case A: if `(isSelf || isRunning) && hasPrompt` — set `needs_column_prompt = 1` and skip `ctx.onTransition` call
- [x] 4.3 Case B: if `!isSelf && !isRunning && hasPrompt` — call `ctx.onTransition(movedTaskId, targetState)`
- [x] 4.4 Case C: no `on_enter_prompt` — existing behavior (update state + notify only)

## 5. StreamProcessor: Deferred Drain

- [x] 5.1 Add two optional callback params to `StreamProcessor` constructor: `onDeferredTransition?: (taskId: number, toState: string) => void` and `onPendingMessage?: (taskId: number, message: string) => void` (default to no-ops)
- [x] 5.2 Update `Orchestrator` to pass `(tid, state) => void this.transitionExecutor.execute(tid, state)` and `(tid, msg) => void this.humanTurnExecutor.execute(tid, msg)` when constructing `StreamProcessor`
- [x] 5.3 In `StreamProcessor.consume()` finally block, after reading `finalRow`: if `needs_column_prompt === 1`, clear flag first, then call `void this.onDeferredTransition(taskId, finalRow.workflow_state)`
- [x] 5.4 Else in finally block: drain `pending_messages` — select rows, delete all rows first, then call `void this.onPendingMessage(taskId, content)` for each

## 6. tasks.transition Handler: Deferred Path

- [x] 6.1 In `src/bun/handlers/tasks.ts` `tasks.transition` handler, check if `execution_state === 'running'` before calling `TransitionExecutor.execute()`
- [x] 6.2 If running: update `workflow_state` and `position` directly; if target column has `on_enter_prompt`, set `needs_column_prompt = 1`; append a `transition_event` message; call `onTaskUpdated(updatedRow)`; return `{ task: updatedRow, executionId: null }`
- [x] 6.3 If not running: existing path via `TransitionExecutor.execute()` (unchanged)

## 7. Frontend: Unread Dot Fix

- [x] 7.1 In `src/mainview/stores/task.ts`, remove `markTaskUnread` calls from `onTaskStreamEvent` (all stream event types)
- [x] 7.2 Remove `markTaskUnread` calls from `onTaskNewMessage` (all message types including `file_diff`)
- [x] 7.3 In `onTaskUpdated`, add `markTaskUnread` only when `activity.kind === 'execution'` AND `activity.nextState` is in `['completed', 'waiting_user', 'failed', 'cancelled']` AND the task is not the currently active task

## 8. Backend Tests

- [x] 8.1 `src/bun/test/helpers.ts` — add `needs_column_prompt INTEGER NOT NULL DEFAULT 0` to the inline tasks table schema (mirrors migration 034)
- [x] 8.2 `src/bun/test/tasks-tools.test.ts` — add MT-A1 (self-move to prompt column → flag=1, onTransition NOT called), MT-A2 (cross-task running target → flag=1, no call), MT-B1 (cross-task idle target → onTransition called), MT-C1 (no prompt column → neither flag nor call)
- [x] 8.3 `src/bun/test/transition-executor.test.ts` — add TE-BADGE (returned task has `executionState='running'`); update `StubStreamProcessor` constructor `super()` call to pass two extra `() => {}` no-ops
- [x] 8.4 `src/bun/test/stream-processor.test.ts` — update all 6 `new StreamProcessor(...)` calls to pass two extra `() => {}` no-ops; add SP-7 (flag=1 → onDeferredTransition fires, flag cleared), SP-8 (pending_messages → onPendingMessage per row, rows deleted), SP-9 (both absent → neither fires), SP-10 (flag=1 AND pending_messages → only onDeferredTransition fires)
- [x] 8.5 `src/bun/test/handlers.test.ts` — add TH-DEFER-1 (running task + prompt column → workflow_state updated, flag=1, executionId:null), TH-DEFER-2 (running task + non-prompt column → flag=0, executionId:null)

## 9. Frontend Tests

- [x] 9.1 `src/mainview/stores/task.test.ts` — add T10 (onTaskUpdated kind=execution completed → markTaskUnread called), T11 (kind=execution running → NOT called), T12 (kind=workflow → NOT called), T13 (kind=execution completed but active task → NOT called), T14 (onTaskStreamEvent assistant event → NOT called), T15 (onTaskNewMessage → NOT called), T16 (kind=execution waiting_user → called)

## 10. Playwright Tests

- [x] 10.1 `e2e/ui/board-unread.spec.ts` — update UNREAD-1, UNREAD-3, UNREAD-4 to use `task.updated` with terminal `executionState` instead of `message.new`; add UNREAD-5 (task.updated completed → dot visible), UNREAD-6 (task.updated running → NO dot), UNREAD-7 (workflow_state change only → NO dot)
- [x] 10.2 Playwright — add deferred-prompt DnD test: drag running task to prompt column → card moves, badge stays `Running`; add drawer test: column select while running → `executionId:null`, badge stays `Running`
