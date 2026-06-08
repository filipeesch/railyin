# Board Tool Executor Tests

## Purpose

Test coverage for the `BoardToolExecutor` class focusing on the integration seam between `BoardToolExecutor` and `WorkspaceRepository` using in-memory DB injection.

## Requirements

### Requirement: board-tool-executor.test.ts covers constructor contract and workspace routing
The test file `src/bun/test/board-tool-executor.test.ts` SHALL exist and test `BoardToolExecutor` with a real `WorkspaceRepository(db)` and `BoardRepository(db)` using an in-memory DB via `initDb()` + `setupTestConfig()`. It SHALL NOT duplicate the 50+ tool-method scenarios already in `tasks-tools.test.ts`; it SHALL focus on the integration seam between `BoardToolExecutor` and `WorkspaceRepository`.

#### Scenario: BE-1 constructor satisfies IBoardToolExecutor
- **WHEN** `const exec: IBoardToolExecutor = new BoardToolExecutor(db, wsRepo, boardRepo)` is evaluated
- **THEN** TypeScript compiles without errors

#### Scenario: BE-2 getTask returns task data for known id
- **WHEN** a task exists in the in-memory DB and `executor.getTask({ task_id: id }, ctx)` is called
- **THEN** the returned string contains the task title

#### Scenario: BE-3 getTask returns error string for unknown id
- **WHEN** no task with the given id exists and `executor.getTask({ task_id: 999 }, ctx)` is called
- **THEN** the returned string starts with `"Error:"`

#### Scenario: BE-4 createTask respects workspace routing via injected wsRepo
- **WHEN** `executor.createTask({ title: "T", project_key: "p", board_id: boardId }, ctx)` is called
- **THEN** a new task row is inserted into the in-memory DB (not the production DB)

#### Scenario: BE-5 moveTask updates workflow_state in injected DB
- **WHEN** `executor.moveTask({ task_id: id, workflow_state: "done" }, ctx)` is called with a valid task and column
- **THEN** the task's `workflow_state` is updated in the in-memory DB

#### Scenario: BE-6 messageTask delivers to idle task via injected callbacks
- **WHEN** `executor.messageTask({ task_id: id, message: "hello" }, ctx)` is called with an idle task
- **THEN** `ctx.onHumanTurn` is invoked

### Requirement: BE-7 Error includes board list when boards exist
The test suite SHALL verify that `execGetBoardSummary` returns an error with available boards when `board_id` is missing.

#### Scenario: BE-7.1 Error contains board list
- **WHEN** `execGetBoardSummary` is called with no `board_id` and `ctx.boardId` is unset
- **AND** the workspace has boards with id=1 (name="Open Spec") and id=2 (name="Design")
- **THEN** the error message contains `"Available boards: Board #1: \"Open Spec\", Board #2: \"Design\""`

### Requirement: BE-8 Error indicates no boards when workspace is empty
The test suite SHALL verify that the error indicates no boards are available when the workspace is empty.

#### Scenario: BE-8.1 Empty workspace error
- **WHEN** `execGetBoardSummary` is called with no `board_id` and `ctx.boardId` is unset
- **AND** the workspace has no boards
- **THEN** the error message contains `"No boards are currently available"`

### Requirement: BE-9 list_cards error includes board list
The test suite SHALL verify that `execListTasks` returns an error with available boards.

#### Scenario: BE-9.1 list_cards error format
- **WHEN** `execListTasks` is called with no `board_id` and `ctx.boardId` is unset
- **AND** the workspace has at least one board
- **THEN** the error message contains `"Available boards:"` followed by board id and name

### Requirement: BE-10 create_card error includes board list
The test suite SHALL verify that `execCreateTask` returns an error with available boards.

#### Scenario: BE-10.1 create_card error format
- **WHEN** `execCreateTask` is called with no `board_id` and `ctx.boardId` is unset
- **AND** the workspace has at least one board
- **THEN** the error message contains `"Available boards:"` followed by board id and name

### Requirement: BE-11 Board queries use BoardRepository
The test suite SHALL verify that `BoardToolExecutor` delegates board queries to the injected repository.

#### Scenario: BE-11.1 exists() is called for board validation
- **WHEN** `execGetBoardSummary` is called with a valid `board_id`
- **AND** a mock `IBoardRepository` is injected
- **THEN** `mockBoardRepo.exists(boardId)` is called and no direct DB query against boards table is executed

### Requirement: BE-12 Board listing uses BoardRepository
The test suite SHALL verify that `execListBoards` delegates to the repository.

#### Scenario: BE-12.1 listByWorkspace is called
- **WHEN** `execListBoards` is called
- **AND** a mock `IBoardRepository` is injected
- **THEN** `mockBoardRepo.listByWorkspace(ctx.workspaceKey)` is called

### Requirement: BE-13 Error scoped to workspace
The test suite SHALL verify that the error message lists only boards from the current workspace.

#### Scenario: BE-13.1 Cross-workspace isolation in error
- **WHEN** workspace "ws1" has board #1 and workspace "ws2" has board #2
- **AND** `execGetBoardSummary` is called with `ctx.workspaceKey = "ws1"` and no `board_id`
- **THEN** the error message contains only board #1, not board #2

### Requirement: BE-14 Board list ordered by created_at
The test suite SHALL verify that the board list in the error message is ordered by creation time.

#### Scenario: BE-14.1 Ordered board list
- **WHEN** workspace has boards created at different times
- **THEN** the error message lists boards in `created_at ASC` order

### Requirement: tasks.create integration position coverage
The `tasks.create` RPC handler position behaviour SHALL be covered by integration tests in suite `TC-POS` within `src/bun/test/handlers.test.ts`. Each test MUST use an in-memory DB via `initDb()` and assert both the handler response `position` field and the persisted DB row.

#### Scenario: TC-POS-1 — first task lands at 500
- **WHEN** `tasks.create` is called on an empty backlog
- **THEN** the returned task has `position === 500`
- **AND** the DB row for that task has `position = 500`

#### Scenario: TC-POS-2 — second task lands below first
- **WHEN** one task already exists in backlog at position `500`
- **AND** `tasks.create` is called again
- **THEN** the returned task has `position < 500`
- **AND** the new task's DB position is `250` (500 / 2)

#### Scenario: TC-POS-3 — third task lands below second
- **WHEN** two tasks exist in backlog at positions `250` and `500`
- **AND** `tasks.create` is called a third time
- **THEN** the returned task has `position < 250`
- **AND** the new task's DB position is `125` (250 / 2)

#### Scenario: TC-POS-4 — returned position matches DB
- **WHEN** `tasks.create` returns a task
- **THEN** the `position` field in the response MUST exactly equal the `position` column in the `tasks` DB row
