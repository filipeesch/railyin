## 1. Backend Unit Tests — TaskRepository

- [ ] 1.1 Create `src/bun/test/task-repository.test.ts`; use `initDb()` for in-memory DB and construct `new TaskRepository(db)` directly — no stubs
- [ ] 1.2 Write TR-1: insert a task + `task_git_context` row; assert `findById` returns task with `worktreePath === '/tmp/test'`
- [ ] 1.3 Write TR-2: insert a task with no `task_git_context` row; assert `findById` returns task with `worktreePath === null`
- [ ] 1.4 Write TR-3: assert `findById(nonExistentId)` returns `null`

## 2. Backend Unit Tests — TransitionExecutor Regression

- [ ] 2.1 In `src/bun/test/transition-executor.test.ts`, add TE-7: call `executor.execute(taskId, toState)` for a column with `on_enter_prompt`; assert `result.task.executionState === 'running'`
- [ ] 2.2 Add TE-8: in the same test (or a sibling), assert `result.task.currentExecutionId === result.executionId` and both are non-null

## 3. Backend Unit Tests — StreamProcessor Error Paths and Worktree

- [ ] 3.1 In `src/bun/test/stream-processor.test.ts`, add SP-7: use a `ThrowingEngine`, call `sp.createSignal(executionId)` before `await sp.consume(...)`, call `sp.setOnStreamEvent(captureCb)` before consume; assert `signal.aborted === true` after consume settles
- [ ] 3.2 Add SP-7b: in the same test, assert `captureCb` received an event with `type === 'done'`
- [ ] 3.3 Add SP-8: use a `FatalErrorEngine` (yields `{ type:"error", error:{ fatal:true } }`); assert `signal.aborted === true` after consume
- [ ] 3.4 Add SP-8b: assert `captureCb` received `{ type: 'done' }` in the fatal error path
- [ ] 3.5 Add SP-9: seed a `task_git_context` row in the in-memory DB for the test task; inject `onTaskUpdated = vi.fn()` via constructor; run `consume()` to normal completion; assert the last `onTaskUpdated` call received a task with `worktreePath !== null`

## 4. Playwright — Board DnD Regression

- [ ] 4.1 In `e2e/ui/board-dnd.spec.ts`, add DND-10: mock `tasks.transition` to return a task with `executionState: 'running'`; drag a card to a prompted column; assert the card's execution badge shows running state

## 5. Playwright — Drawer Toolbar Tests

- [ ] 5.1 In `e2e/ui/task-toolbar.spec.ts`, add TT-12: use `makeWorkflowTemplate` with `backlog.allowedTransitions = ['plan']`; open the workflow select; assert `plan` option present and other columns absent
- [ ] 5.2 Add TT-13: use standard template with no `allowedTransitions`; open the workflow select; assert all workflow columns are present
- [ ] 5.3 Add TT-14: start with `makeTask({ worktreePath: '/tmp/test' })`; open drawer; verify terminal button visible; push `task.updated` with the same task (worktreePath preserved); assert terminal button still visible

## 6. Playwright — Stream Reactivity Tests

- [ ] 6.1 In `e2e/ui/stream-reactivity.spec.ts`, add E-X: set task `executionState: 'running'`, open drawer; push `task.updated` with `executionState: 'failed'`; push `done` stream event; assert streaming indicator gone and send button enabled
- [ ] 6.2 Add E-Y: push 5 + 5 + 5 `text_chunk` events in three batches; after each batch use `page.waitForFunction` to assert `scrollTop + clientHeight >= scrollHeight - 40`

## 7. Playwright — Conversation Scroll Tests

- [ ] 7.1 In `e2e/ui/conversation-body.spec.ts`, add CB-X: push 10 `reasoning_chunk` events with long content; assert `rb__body.scrollTop + rb__body.clientHeight >= rb__body.scrollHeight - 10` via `page.waitForFunction`

## 8. Playwright — Pagination Sentinel Test

- [ ] 8.1 In `e2e/ui/conversation-pagination.spec.ts`, add PAG-9: seed 3 messages with `hasMore: true`; push a few tokens then `done`; use `evaluate(el => el.scrollTop = 0)` to force scroll; capture `conversations.getMessages` calls; assert it was called a second time (load-older triggered by the watcher)
