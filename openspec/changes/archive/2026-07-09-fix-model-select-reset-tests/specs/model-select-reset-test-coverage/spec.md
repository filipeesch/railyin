## ADDED Requirements

### Requirement: task-queries helpers are unit-tested in isolation
The `fetchTaskWithModel` and `fetchChatSessionWithModel` helpers in `src/bun/db/task-queries.ts` SHALL be tested with a real in-memory SQLite database via `initDb()`. Each function MUST be called directly — no orchestrator or handler in the loop.

#### Scenario: TQ-1 fetchTaskWithModel returns model from conversations JOIN
- **WHEN** a task row exists with a linked conversation where `model = 'test/model'`
- **THEN** `fetchTaskWithModel(db, taskId)` returns a `Task` with `model === 'test/model'`

#### Scenario: TQ-2 fetchTaskWithModel returns model null when conversation model is NULL
- **WHEN** a task row exists with a linked conversation where `model` column IS NULL
- **THEN** `fetchTaskWithModel(db, taskId)` returns a `Task` with `model === null`

#### Scenario: TQ-3 fetchTaskWithModel returns null for missing taskId
- **WHEN** no task with the given id exists
- **THEN** `fetchTaskWithModel(db, taskId)` returns `null`

#### Scenario: TQ-4 fetchTaskWithModel includes git context columns
- **WHEN** a task has a linked `task_git_context` row with `branch_name = 'main'`
- **THEN** the returned `Task` includes the git context field values

#### Scenario: TQ-5 fetchChatSessionWithModel returns model from conversations JOIN
- **WHEN** a chat session row exists with a linked conversation where `model = 'test/model'`
- **THEN** `fetchChatSessionWithModel(db, sessionId)` returns a `ChatSession` with `model === 'test/model'`

#### Scenario: TQ-6 fetchChatSessionWithModel returns model null when conversation model is NULL
- **WHEN** a chat session row exists with a linked conversation where `model` column IS NULL
- **THEN** `fetchChatSessionWithModel(db, sessionId)` returns a `ChatSession` with `model === null`

#### Scenario: TQ-7 fetchChatSessionWithModel returns null for missing sessionId
- **WHEN** no chat session with the given id exists
- **THEN** `fetchChatSessionWithModel(db, sessionId)` returns `null`

---

### Requirement: TaskRepository.findById is regression-tested for model propagation
`TaskRepository.findById` SHALL be covered by at least one test asserting that the `model` field is correctly populated from the `conversations` JOIN.

#### Scenario: TR-MODEL-1 findById returns task with correct model
- **WHEN** `TaskRepository.findById(taskId)` is called on a task with a linked conversation where `model = 'fake/fake'`
- **THEN** the returned `Task.model === 'fake/fake'`

---

### Requirement: chatSession handler push paths are tested for model propagation
The `chatSessionHandlers` `onSessionUpdated` callback SHALL be captured in tests for the 5 operations that push `chatSession.updated` events (`setModel`, `create`, `rename`, `archive`, cancel). Each captured session MUST have `model !== null` when the linked conversation has a model set.

#### Scenario: CS-SET-1 setModel push carries correct model
- **WHEN** `chatSessions.setModel` is called with a valid session and model
- **THEN** the `onSessionUpdated` callback receives a session with `model === 'test/model'`

#### Scenario: CS-SET-2 setModel HTTP return carries correct model
- **WHEN** `chatSessions.setModel` is called
- **THEN** the HTTP response body contains `model === 'test/model'` (not null)

#### Scenario: CS-CREATE-1 create push carries model
- **WHEN** `chatSessions.create` creates a new session
- **THEN** the `onSessionUpdated` callback receives a session with `model` matching the workspace default (or null if none configured — explicit assertion either way)

#### Scenario: CS-RENAME-1 rename push preserves model
- **WHEN** `chatSessions.rename` is called on a session with `model = 'fake/fake'`
- **THEN** the `onSessionUpdated` callback receives a session with `model === 'fake/fake'`

#### Scenario: CS-ARCHIVE-1 archive push preserves model
- **WHEN** `chatSessions.archive` is called on a session with `model = 'fake/fake'`
- **THEN** the `onSessionUpdated` callback receives a session with `model === 'fake/fake'`

---

### Requirement: Orchestrator cancel and shell-approval push paths are tested for model propagation
The `Orchestrator.cancel` and `Orchestrator.respondShellApproval` callbacks SHALL assert that the `task.updated` push carries the task's `model` value from the `conversations` JOIN.

#### Scenario: OC-MODEL-1 cancel push carries correct model
- **WHEN** a running execution is cancelled for a task whose conversation has `model = 'fake/fake'`
- **THEN** the last entry in `taskUpdates` has `model === 'fake/fake'`

#### Scenario: OSA-MODEL-1 shell approval push carries correct model
- **WHEN** `respondShellApproval` completes for a task whose conversation has `model = 'fake/fake'`
- **THEN** the last entry in `taskUpdates` has `model === 'fake/fake'`

---

### Requirement: TransitionExecutor returned task carries correct model
`TransitionExecutor.execute()` SHALL return a result whose `task.model` reflects the value from the `conversations` JOIN.

#### Scenario: TE-MODEL-1 returned task has correct model
- **WHEN** `TransitionExecutor.execute()` completes for a task whose conversation has `model = 'fake/fake'`
- **THEN** `result.task.model === 'fake/fake'`

---

### Requirement: CodeReviewExecutor onTaskUpdated push carries correct model
`CodeReviewExecutor.execute()` SHALL call `onTaskUpdated` with a task whose `model` field comes from the `conversations` JOIN.

#### Scenario: CR-MODEL-1 onTaskUpdated receives task with correct model
- **WHEN** `CodeReviewExecutor.execute()` completes for a task whose conversation has `model = 'fake/fake'`
- **THEN** the captured `onTaskUpdated` call has `task.model === 'fake/fake'`

---

### Requirement: Frontend task store round-trips model field correctly
The Pinia task store's `onTaskUpdated` SHALL pass through the `model` field of the incoming task object without modification.

#### Scenario: T-MODEL-1 onTaskUpdated with a model preserves it
- **WHEN** `onTaskUpdated` is called with a task where `model = 'test/model'`
- **THEN** `taskIndex[id].model === 'test/model'`

#### Scenario: T-MODEL-2 onTaskUpdated with null model stores null
- **WHEN** `onTaskUpdated` is called with a task where `model = null`
- **THEN** `taskIndex[id].model === null`

---

### Requirement: Frontend chat store round-trips model field correctly
The Pinia chat store's `onChatSessionUpdated` SHALL pass through the `model` field of the incoming session object without modification.

#### Scenario: C-MODEL-1 onChatSessionUpdated with a model preserves it
- **WHEN** `onChatSessionUpdated` is called with a session where `model = 'test/model'`
- **THEN** `sessions[0].model === 'test/model'`

#### Scenario: C-MODEL-2 onChatSessionUpdated with null model stores null
- **WHEN** `onChatSessionUpdated` is called with a session where `model = null`
- **THEN** `sessions[0].model === null`

---

### Requirement: Playwright E2E tests cover the direct user-visible model-reset scenario
The Playwright suite for model persistence SHALL include tests that verify the model dropdown does not reset when a WS push arrives carrying the correct model, and that it updates correctly when a WS push arrives carrying a different model.

#### Scenario: MP-E1 session WS push with same model does not reset dropdown
- **WHEN** user opens a session chat, selects model X, and a `chatSession.updated` WS push arrives with `model = X`
- **THEN** the model dropdown still shows model X (no reset to first model)

#### Scenario: MP-E2 session WS push with different model updates dropdown
- **WHEN** user opens a session chat, selects model X, and a `chatSession.updated` WS push arrives with `model = Y`
- **THEN** the model dropdown updates to show model Y

#### Scenario: MP-F1 task WS push with same model does not reset dropdown
- **WHEN** user opens a task chat, selects model X, and a `task.updated` WS push arrives with `model = X`
- **THEN** the model dropdown still shows model X (no reset to first model)

#### Scenario: MP-F2 task WS push with different model updates dropdown
- **WHEN** user opens a task chat, selects model X, and a `task.updated` WS push arrives with `model = Y`
- **THEN** the model dropdown updates to show model Y

---

### Requirement: Executor test stubs are extracted to a shared helper module
The test-only stubs `TestEngine`, `CapturingParamsBuilder`, `StubWorkdirResolver`, and `StubStreamProcessor` SHALL reside in `src/bun/test/executor-test-helpers.ts` and be imported by any test file that needs them. No test file SHALL define its own local copy of these stubs.

#### Scenario: ETH-1 human-turn-executor.test.ts imports from shared helpers
- **WHEN** `human-turn-executor.test.ts` is read
- **THEN** the 4 stubs are imported from `./executor-test-helpers` (not defined inline)

#### Scenario: ETH-2 code-review-executor.test.ts imports from shared helpers
- **WHEN** `code-review-executor.test.ts` is read
- **THEN** the 4 stubs are imported from `./executor-test-helpers` (not defined inline)
