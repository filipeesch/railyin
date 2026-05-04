# Board Tool Executor

## Purpose

Defines the `IBoardToolExecutor` interface and `BoardToolExecutor` class that implement board/task tool operations with constructor-injected DB and workspace repository, enabling test isolation and DI.

## Requirements

### Requirement: IBoardToolExecutor interface
The system SHALL define an `IBoardToolExecutor` interface in `src/bun/workflow/tools/board-tools.ts` with methods corresponding to each board/task tool: `getTask`, `getBoardSummary`, `listTasks`, `createTask`, `editTask`, `deleteTask`, `moveTask`, `messageTask`. Each method SHALL accept `(args: Record<string, unknown>, ctx: BoardToolContext)` and return `Promise<string>`.

#### Scenario: Interface enables mock injection
- **WHEN** a test constructs a mock implementing `IBoardToolExecutor`
- **THEN** it can be assigned to `CommonToolContext.boardTools` without compile errors

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
