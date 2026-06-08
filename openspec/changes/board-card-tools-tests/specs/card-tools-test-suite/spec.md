## ADDED Requirements

### Requirement: Test suite covers list_boards tool
The test suite SHALL include tests for the `list_boards` tool covering: successful retrieval of boards, empty result when no boards exist, and membership in the `cards_read` tool group.

#### Scenario: list_boards returns board id and name
- **WHEN** `executeCommonTool("list_boards", {}, commonCtx())` is called with seeded boards
- **THEN** the result is a JSON array containing `{ id, name }` objects

#### Scenario: list_boards returns empty array when no boards exist
- **WHEN** `executeCommonTool("list_boards", {}, commonCtx())` is called with no boards in the DB
- **THEN** the result is an empty JSON array `[]`

#### Scenario: list_boards is in cards_read group
- **WHEN** `TOOL_GROUPS.get("cards_read")` is inspected
- **THEN** the array includes `"list_boards"`

### Requirement: Test suite covers card tool name routing
The test suite SHALL verify that all renamed card tools route correctly through `executeCommonTool()`.

#### Scenario: get_card returns task data
- **WHEN** `executeCommonTool("get_card", { task_id: taskId }, commonCtx())` is called
- **THEN** the result contains task metadata (id, title, workflowState)

#### Scenario: list_cards returns tasks
- **WHEN** `executeCommonTool("list_cards", {}, commonCtx())` is called
- **THEN** the result is a JSON array of task objects

#### Scenario: create_card creates a task
- **WHEN** `executeCommonTool("create_card", { project_key, title, description }, commonCtx())` is called
- **THEN** a new task is created and returned with id > 0

#### Scenario: edit_card updates a task
- **WHEN** `executeCommonTool("edit_card", { task_id, title }, commonCtx())` is called
- **THEN** the task title is updated

#### Scenario: delete_card removes a task
- **WHEN** `executeCommonTool("delete_card", { task_id }, commonCtx())` is called
- **THEN** the task is removed from the DB

#### Scenario: move_card changes workflow_state
- **WHEN** `executeCommonTool("move_card", { task_id, workflow_state: "done" }, commonCtx())` is called
- **THEN** the task's workflow_state is updated to "done"

#### Scenario: message_card delivers message
- **WHEN** `executeCommonTool("message_card", { task_id, message: "Hi" }, commonCtx())` is called on an idle task
- **THEN** `onHumanTurn` callback is invoked

### Requirement: Test suite covers board tools from chat context
The test suite SHALL verify that board tools work when `ctx.task.boardId` is null (chat session context) with explicit `board_id` in args.

#### Scenario: list_cards succeeds with explicit board_id in chat context
- **WHEN** `executeCommonTool("list_cards", { board_id: boardId }, commonCtx({ boardId: undefined }))` is called
- **THEN** the result contains tasks from the specified board

#### Scenario: create_card succeeds with explicit board_id in chat context
- **WHEN** `executeCommonTool("create_card", { board_id: boardId, project_key, title, description }, commonCtx({ boardId: undefined }))` is called
- **THEN** a new card is created on the specified board

#### Scenario: get_board_summary succeeds with explicit board_id in chat context
- **WHEN** `executeCommonTool("get_board_summary", { board_id: boardId }, commonCtx({ boardId: undefined }))` is called
- **THEN** the result contains column breakdown for the specified board

### Requirement: Test suite verifies error messages reference list_boards
The test suite SHALL verify that board tool error messages mention `list_boards` when board_id is missing.

#### Scenario: create_card error mentions list_boards
- **WHEN** `executeCommonTool("create_card", { project_key, title, description }, commonCtx({ boardId: undefined }))` is called
- **THEN** the error text contains `list_boards`

#### Scenario: list_cards error mentions list_boards
- **WHEN** `executeCommonTool("list_cards", {}, commonCtx({ boardId: undefined }))` is called
- **THEN** the error text contains `list_boards`

### Requirement: Test suite verifies display labels for card tools
The test suite SHALL verify that `buildCommonToolDisplay` returns correct labels for all card-named tools.

#### Scenario: create_card display label is "create card"
- **WHEN** `buildCommonToolDisplay("create_card", { title: "Test" })` is called
- **THEN** the result is `{ label: "create card", subject: "Test" }`

#### Scenario: list_boards display label is "list boards"
- **WHEN** `buildCommonToolDisplay("list_boards", {})` is called
- **THEN** the result is `{ label: "list boards" }`

### Requirement: Tool registry tests use new group names
The test suite SHALL verify that `TOOL_GROUPS` uses `cards_read` and `cards_write` group names with correct tool lists.

#### Scenario: cards_read group has correct tools
- **WHEN** `TOOL_GROUPS.get("cards_read")` is inspected
- **THEN** the array includes `"get_card"`, `"get_board_summary"`, `"list_cards"`, `"list_boards"`

#### Scenario: cards_write group has correct tools
- **WHEN** `TOOL_GROUPS.get("cards_write")` is inspected
- **THEN** the array includes `"create_card"`, `"edit_card"`, `"delete_card"`, `"move_card"`, `"message_card"`

#### Scenario: Child tools exclude card tools
- **WHEN** `buildChildTools()` is called with read/write/shell groups
- **THEN** none of the card tool names appear in the result

### Requirement: RPC scenario tests use new tool names
The test suite SHALL use card-named tools in all RPC scenario mock step definitions.

#### Scenario: Claude RPC scenarios use card tool names
- **WHEN** Claude RPC scenario tests run with tool call mocks
- **THEN** mock steps use `create_card` and `edit_card` tool names

#### Scenario: Copilot RPC scenarios use card tool names
- **WHEN** Copilot RPC scenario tests run with tool call mocks
- **THEN** mock steps use `create_card` and `edit_card` tool names

#### Scenario: OpenCode RPC scenarios use card tool names
- **WHEN** OpenCode RPC scenario tests run with tool call mocks
- **THEN** mock steps use card-named tools
