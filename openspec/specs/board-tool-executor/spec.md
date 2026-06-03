# Board Tool Executor

## Purpose

Defines the `IBoardToolExecutor` interface and `BoardToolExecutor` class that implement board/task tool operations with constructor-injected DB and workspace repository, enabling test isolation and DI.

## Requirements

### Requirement: IBoardToolExecutor interface
The system SHALL define an `IBoardToolExecutor` interface in `src/bun/workflow/tools/board-tools.ts` with methods corresponding to each board/task tool: `getTask`, `getBoardSummary`, `listTasks`, `createTask`, `editTask`, `deleteTask`, `moveTask`, `messageTask`. Each method SHALL accept `(args: Record<string, unknown>, ctx: BoardToolContext)` and return `Promise<string>`.

The `get_board_summary`, `list_tasks`, and `create_task` tool schemas in `registry.ts` SHALL NOT include a `board_id` parameter. These tools resolve the board from `ctx.boardId` exclusively. The executor's fallback to `ctx.boardId` remains unchanged.

#### Scenario: Interface enables mock injection
- **WHEN** a test constructs a mock implementing `IBoardToolExecutor`
- **THEN** it can be assigned to `CommonToolContext.boardTools` without compile errors

#### Scenario: get_board_summary schema has no board_id field
- **WHEN** the `get_board_summary` tool definition is inspected
- **THEN** `parameters.properties` does not contain a `board_id` key

#### Scenario: list_tasks schema has no board_id field
- **WHEN** the `list_tasks` tool definition is inspected
- **THEN** `parameters.properties` does not contain a `board_id` key

#### Scenario: create_task schema has no board_id field
- **WHEN** the `create_task` tool definition is inspected
- **THEN** `parameters.properties` does not contain a `board_id` key

#### Scenario: Executor still resolves board from context when board_id omitted
- **WHEN** `execGetBoardSummary` is called with an args object that does not include `board_id`
- **AND** `ctx.boardId` is set to a valid board ID
- **THEN** the executor queries that board and returns a summary

### Requirement: BoardToolExecutor class
The system SHALL provide a `BoardToolExecutor` class that implements `IBoardToolExecutor`. Its constructor SHALL accept `(db: Database, wsRepo: IWorkspaceRepository)`. It SHALL NOT call `getDb()` internally.

#### Scenario: Constructor injection replaces getDb()
- **WHEN** `new BoardToolExecutor(db, wsRepo)` is called with an in-memory DB
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

### Requirement: BoardToolExecutor assigns top-of-column position on task creation
The system SHALL assign a top-of-column position to tasks created via `BoardToolExecutor.execCreateTask`. The position SHALL be computed using `PositionService.getTopPosition(boardId, 'backlog')` — returning `MIN(position) / 2` or `500` when the column is empty. The position SHALL be stored explicitly in the database; the behaviour MUST NOT rely on the DB column default (`0`).

#### Scenario: AI-created task appears at the top of the backlog column
- **WHEN** an AI agent invokes `execCreateTask` on a board whose backlog contains tasks with positions `[1000, 2000]`
- **THEN** the created task is assigned position `500` and appears at the top of the backlog column

#### Scenario: AI-created task in empty backlog receives position 500
- **WHEN** an AI agent invokes `execCreateTask` on a board with an empty backlog
- **THEN** the created task is assigned position `500`
