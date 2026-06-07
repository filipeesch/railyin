# Board Tool Executor

## Purpose

Defines the `IBoardToolExecutor` interface and `BoardToolExecutor` class that implement board/task tool operations with constructor-injected DB, workspace repository, and board repository, enabling test isolation and DI.

## MODIFIED Requirements

### Requirement: BoardToolExecutor class
The system SHALL provide a `BoardToolExecutor` class that implements `IBoardToolExecutor`. Its constructor SHALL accept `(db: Database, wsRepo: IWorkspaceRepository, boardRepo: IBoardRepository)`. It SHALL NOT call `getDb()` internally. Board-related queries MUST be delegated to the injected `IBoardRepository` rather than executed directly against the database.

#### Scenario: Constructor injection replaces getDb()
- **WHEN** `new BoardToolExecutor(db, wsRepo, boardRepo)` is called with an in-memory DB and board repository
- **THEN** `getTask`, `createTask`, `moveTask`, and all other methods query that in-memory DB

#### Scenario: getTask returns task JSON
- **WHEN** a task with id=1 exists in the in-memory DB
- **THEN** `executor.getTask({ task_id: 1 }, ctx)` returns a JSON string containing the task

#### Scenario: getTask returns error for missing task
- **WHEN** no task with the given id exists
- **THEN** the return value starts with `"Error:"`

#### Scenario: createTask inserts and returns new task
- **WHEN** `createTask` is called with valid board_id, title, and workflow_state
- **THEN** a new row is inserted in the tasks table and returned as JSON

#### Scenario: moveTask updates workflow_state
- **WHEN** `moveTask` is called with a valid task_id and to_state
- **THEN** the task's `workflow_state` is updated in the DB

### Requirement: Inline board list in error messages
The system SHALL include available boards directly in error messages when `board_id` is missing from both `args` and `ctx`. The error message SHALL list boards scoped to the current workspace (matching `list_boards` behavior). When no boards exist in the workspace, the error SHALL indicate that no boards are available.

#### Scenario: Error includes board list when boards exist
- **WHEN** `execGetBoardSummary` is called with no `board_id` in args and `ctx.boardId` is unset
- **AND** the workspace has boards with id=1 (name="Open Spec") and id=2 (name="Design")
- **THEN** the error message contains `"Available boards: Board #1: \"Open Spec\", Board #2: \"Design\""`

#### Scenario: Error indicates no boards when workspace is empty
- **WHEN** `execGetBoardSummary` is called with no `board_id` in args and `ctx.boardId` is unset
- **AND** the workspace has no boards
- **THEN** the error message contains `"No boards are currently available"`

#### Scenario: list_cards error includes board list
- **WHEN** `execListTasks` is called with no `board_id` in args and `ctx.boardId` is unset
- **AND** the workspace has at least one board
- **THEN** the error message contains `"Available boards:"` followed by board id and name

#### Scenario: create_card error includes board list
- **WHEN** `execCreateTask` is called with no `board_id` in args and `ctx.boardId` is unset
- **AND** the workspace has at least one board
- **THEN** the error message contains `"Available boards:"` followed by board id and name

#### Scenario: Board queries use BoardRepository
- **WHEN** `execGetBoardSummary` is called with a valid board_id
- **AND** the board repository's `exists` method returns true
- **THEN** the executor returns a board summary without executing a direct database query against the boards table

#### Scenario: Board listing uses BoardRepository
- **WHEN** `execListBoards` is called
- **THEN** the executor delegates to `boardRepo.listByWorkspace(ctx.workspaceKey)` and returns the results as JSON

## ADDED Requirements

### Requirement: Error format is a pure function
The system SHALL provide a pure function `buildBoardNotFoundError` that accepts an array of board summaries and returns a formatted error string. The function SHALL NOT access the database or any external state.

#### Scenario: Pure function formats board list
- **WHEN** `buildBoardNotFoundError([{ id: 1, name: "Board A" }, { id: 2, name: "Board B" }])` is called
- **THEN** the returned string contains `"Available boards: Board #1: \"Board A\", Board #2: \"Board B\""`

#### Scenario: Pure function handles empty board list
- **WHEN** `buildBoardNotFoundError([])` is called
- **THEN** the returned string contains `"No boards are currently available"`
