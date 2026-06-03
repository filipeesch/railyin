## MODIFIED Requirements

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
