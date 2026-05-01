## ADDED Requirements

### Requirement: helpers-schema-sync
`src/bun/test/helpers.ts` inline tasks schema must include `needs_column_prompt INTEGER NOT NULL DEFAULT 0`.

#### Scenario: backend tests can read and write needs_column_prompt
- **WHEN** any backend test creates a task row via `createTask()` helper
- **THEN** the column exists and defaults to `0`

---

### Requirement: stream-processor-constructor-update
All existing `new StreamProcessor(...)` call sites in test files must be updated to pass two additional no-op callbacks.

#### Scenario: existing SP tests compile and pass after constructor change
- **WHEN** `StreamProcessor` constructor gains optional `onDeferredTransition` and `onPendingMessage` params
- **THEN** all 6 existing SP tests (SP-1 through SP-6) still pass without behavior change

---

### Requirement: stub-stream-processor-update
`StubStreamProcessor` in `transition-executor.test.ts` must update its `super()` call to pass two extra `() => {}` no-ops.

#### Scenario: transition-executor tests compile and pass after constructor change
- **WHEN** `StubStreamProcessor` is instantiated
- **THEN** it compiles without TS error and TE-1 through TE-6 still pass

---

### Requirement: stream-processor-deferred-drain
`StreamProcessor` drain behavior is covered by 4 new integration tests.

#### Scenario: SP-7 — needs_column_prompt flag triggers onDeferredTransition
- **WHEN** a task has `needs_column_prompt = 1` when the execution finally block runs
- **THEN** `onDeferredTransition` is called with `(taskId, workflow_state)` and the flag is cleared to `0`

#### Scenario: SP-8 — pending_messages rows trigger onPendingMessage
- **WHEN** a task has `needs_column_prompt = 0` and `pending_messages` rows exist
- **THEN** `onPendingMessage` is called once per row and all rows are deleted

#### Scenario: SP-9 — neither drain fires when nothing is pending
- **WHEN** `needs_column_prompt = 0` and no `pending_messages` rows exist
- **THEN** neither `onDeferredTransition` nor `onPendingMessage` is called

#### Scenario: SP-10 — column prompt takes priority over pending_messages
- **WHEN** `needs_column_prompt = 1` AND `pending_messages` rows exist
- **THEN** only `onDeferredTransition` fires; `onPendingMessage` is NOT called

---

### Requirement: badge-fix-test
`TransitionExecutor.execute()` returns a task with `executionState = 'running'` after writing the running state.

#### Scenario: TE-BADGE — returned task reflects running state
- **WHEN** `transitionExecutor.execute()` completes successfully
- **THEN** the returned `task.executionState` equals `'running'` (not stale `'idle'`)

---

### Requirement: exec-move-task-three-case-tests
`execMoveTask` three-case logic is covered by 4 new integration tests.

#### Scenario: MT-A1 — self-move to prompt column sets flag, skips callback
- **WHEN** the executing task moves itself (`ctx.taskId === movedTaskId`) to a column with `on_enter_prompt`
- **THEN** `needs_column_prompt = 1` in DB and `onTransition` spy is NOT called

#### Scenario: MT-A2 — cross-task move of running target sets flag, skips callback
- **WHEN** a task moves another task that has `execution_state = 'running'` to a column with `on_enter_prompt`
- **THEN** `needs_column_prompt = 1` in DB and `onTransition` spy is NOT called

#### Scenario: MT-B1 — cross-task idle target fires onTransition immediately
- **WHEN** a task moves an idle target to a column with `on_enter_prompt`
- **THEN** `onTransition` spy IS called with `(movedTaskId, targetState)` and `needs_column_prompt = 0`

#### Scenario: MT-C1 — move to non-prompt column leaves flag at 0
- **WHEN** any task is moved to a column with no `on_enter_prompt`
- **THEN** `needs_column_prompt = 0` in DB and `onTransition` spy is NOT called

---

### Requirement: tasks-transition-deferred-handler-tests
`tasks.transition` deferred path (running task) is covered by 2 new handler integration tests.

#### Scenario: TH-DEFER-1 — running task + prompt column defers and sets flag
- **WHEN** `tasks.transition` is called for a task with `execution_state = 'running'` targeting a column with `on_enter_prompt`
- **THEN** `workflow_state` is updated, `needs_column_prompt = 1`, `executionId: null` in response, and `execution_state` remains `'running'`

#### Scenario: TH-DEFER-2 — running task + non-prompt column moves without setting flag
- **WHEN** `tasks.transition` is called for a task with `execution_state = 'running'` targeting a column without `on_enter_prompt`
- **THEN** `workflow_state` is updated, `needs_column_prompt = 0`, `executionId: null` in response

---

### Requirement: frontend-unread-dot-tests
`onTaskUpdated`, `onTaskStreamEvent`, and `onTaskNewMessage` behavior is covered by 7 new frontend unit tests.

#### Scenario: T10 — terminal execution state triggers unread for non-active task
- **WHEN** `onTaskUpdated` receives `kind='execution'` with `nextState='completed'` for a non-active task
- **THEN** `markTaskUnread` is called (task id appears in `unreadTaskIds`)

#### Scenario: T11 — non-terminal execution state does NOT trigger unread
- **WHEN** `onTaskUpdated` receives `kind='execution'` with `nextState='running'` for a non-active task
- **THEN** `markTaskUnread` is NOT called

#### Scenario: T12 — workflow state change does NOT trigger unread
- **WHEN** `onTaskUpdated` receives `kind='workflow'` (column move only) for a non-active task
- **THEN** `markTaskUnread` is NOT called

#### Scenario: T13 — terminal execution state does NOT trigger unread for active task
- **WHEN** `onTaskUpdated` receives `kind='execution'` with `nextState='completed'` for the currently active task
- **THEN** `markTaskUnread` is NOT called

#### Scenario: T14 — streaming token does NOT trigger unread
- **WHEN** `onTaskStreamEvent` receives an `assistant` stream event for a non-active task
- **THEN** `markTaskUnread` is NOT called

#### Scenario: T15 — new message does NOT trigger unread
- **WHEN** `onTaskNewMessage` receives an assistant message for a non-active task
- **THEN** `markTaskUnread` is NOT called

#### Scenario: T16 — waiting_user triggers unread
- **WHEN** `onTaskUpdated` receives `kind='execution'` with `nextState='waiting_user'` for a non-active task
- **THEN** `markTaskUnread` IS called

---

### Requirement: playwright-unread-tests-updated
UNREAD-1, UNREAD-3, UNREAD-4 updated to use `task.updated` with terminal `executionState` as trigger.

#### Scenario: UNREAD-1 updated trigger
- **WHEN** a `task.updated` WS push with `executionState: 'completed'` is received for a non-active task
- **THEN** the unread dot appears on the task card

#### Scenario: UNREAD-3 updated trigger
- **WHEN** same trigger as UNREAD-1
- **THEN** workspace tab shows unread indicator

#### Scenario: UNREAD-4 updated trigger
- **WHEN** the unread state is set up via `task.updated` with terminal state, then user opens the task
- **THEN** the dot disappears

---

### Requirement: playwright-new-unread-tests
3 new Playwright tests covering the negative cases for unread dot behavior.

#### Scenario: UNREAD-5 — completed state shows dot
- **WHEN** `task.updated` with `executionState: 'completed'`
- **THEN** unread dot is visible

#### Scenario: UNREAD-6 — running state does not show dot
- **WHEN** `task.updated` with `executionState: 'running'`
- **THEN** unread dot is NOT visible

#### Scenario: UNREAD-7 — workflow-only change does not show dot
- **WHEN** `task.updated` with only `workflowState` changing (no `executionState` change)
- **THEN** unread dot is NOT visible

---

### Requirement: playwright-deferred-prompt-tests
New Playwright tests for the deferred column prompt flow.

#### Scenario: DND-RUNNING-1 — drag running task to prompt column preserves Running badge
- **WHEN** a task with `executionState: 'running'` is dragged to a column with `on_enter_prompt`
- **THEN** the card appears in the target column and the badge shows `Running` (not `Idle`)

#### Scenario: DRAWER-DEFER-1 — column select while running returns executionId:null
- **WHEN** a running task's column is changed via the drawer select dropdown
- **THEN** the API returns `executionId: null` and the badge stays `Running`
