## MODIFIED Requirements

### Requirement: IBoardToolExecutor interface
The system SHALL define an `IBoardToolExecutor` interface in `src/bun/workflow/tools/board-tools.ts` with methods corresponding to each board/card tool: `getCard`, `getBoardSummary`, `listCards`, `createCard`, `editCard`, `deleteCard`, `moveCard`, `messageCard`, `listBoards`. Each method SHALL accept `(args: Record<string, unknown>, ctx: BoardToolContext)` and return `Promise<string>`.

The `get_board_summary`, `list_cards`, and `create_card` tool schemas SHALL include a `board_id` parameter in `COMMON_TOOL_DEFINITIONS` (engine-facing) but SHALL NOT include a `board_id` parameter in `TOOL_DEFINITIONS` (workflow column resolution). These tools resolve the board from `ctx.boardId` exclusively in workflow contexts. The executor's fallback to `ctx.boardId` remains unchanged.

#### Scenario: Interface enables mock injection
- **WHEN** a test constructs a mock implementing `IBoardToolExecutor`
- **THEN** it can be assigned to `CommonToolContext.boardTools` without compile errors

#### Scenario: get_board_summary schema has no board_id field in workflow tools
- **WHEN** the `get_board_summary` tool definition is inspected in `TOOL_DEFINITIONS` (registry.ts)
- **THEN** `parameters.properties` does not contain a `board_id` key

#### Scenario: list_cards schema has board_id field in engine tools
- **WHEN** the `list_cards` tool definition is inspected in `CARD_TOOL_DEFINITIONS`
- **THEN** `parameters.properties` contains a `board_id` field with description referencing `list_boards`

#### Scenario: create_card schema has board_id field in engine tools
- **WHEN** the `create_card` tool definition is inspected in `CARD_TOOL_DEFINITIONS`
- **THEN** `parameters.properties` contains a `board_id` field with description referencing `list_boards`

#### Scenario: Executor still resolves board from context when board_id omitted
- **WHEN** `execGetBoardSummary` is called with an args object that does not include `board_id`
- **AND** `ctx.boardId` is set to a valid board ID
- **THEN** the executor queries that board and returns a summary

### Requirement: BoardToolExecutor class
The system SHALL provide a `BoardToolExecutor` class that implements `IBoardToolExecutor`. Its constructor SHALL accept `(db: Database, wsRepo: IWorkspaceRepository)`. It SHALL NOT call `getDb()` internally.

#### Scenario: Constructor injection replaces getDb()
- **WHEN** `new BoardToolExecutor(db, wsRepo)` is called with an in-memory DB
- **THEN** `getCard`, `createCard`, `moveCard`, and all other methods query that in-memory DB

#### Scenario: getCard returns card JSON
- **WHEN** a task with id=1 exists in the in-memory DB
- **THEN** `executor.getCard({ task_id: 1 }, ctx)` returns a JSON string containing the task

#### Scenario: getCard returns error for missing card
- **WHEN** no task with the given id exists
- **THEN** the return value starts with `"Error:"`

#### Scenario: createCard inserts and returns new card
- **WHEN** `createCard` is called with valid board_id, title, and workflow_state
- **THEN** a new row is inserted in the tasks table and returned as JSON

#### Scenario: moveCard updates workflow_state
- **WHEN** `moveCard` is called with a valid task_id and to_state
- **THEN** the task's `workflow_state` is updated in the DB

## ADDED Requirements

### Requirement: execListBoards returns board id and name
The `BoardToolExecutor` SHALL provide an `execListBoards` method that queries the `boards` table and returns an array of `{ id: number, name: string }` objects. The method SHALL require no parameters (only the standard `args` and `ctx` parameters).

#### Scenario: execListBoards returns all boards
- **WHEN** `execListBoards({}, ctx)` is called
- **THEN** it returns a JSON array containing `{ id, name }` for each board

#### Scenario: execListBoards returns empty array when no boards exist
- **WHEN** no boards exist in the database
- **AND** `execListBoards({}, ctx)` is called
- **THEN** it returns an empty JSON array `[]`
