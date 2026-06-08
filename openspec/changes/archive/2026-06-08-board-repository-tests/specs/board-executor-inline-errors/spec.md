# Board Executor Inline Errors

## Purpose

Integration tests for `BoardToolExecutor` inline board error messages covering workspace scoping, board listing, and mock-based repository verification.

## Requirements

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
