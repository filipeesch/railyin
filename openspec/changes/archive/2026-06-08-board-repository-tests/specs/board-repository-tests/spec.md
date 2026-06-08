# Board Repository Tests

## Purpose

Unit tests for `IBoardRepository` interface and `BoardRepository` implementation covering all CRUD operations, workspace isolation, and interface contracts.

## Requirements

### Requirement: Interface contract
The test suite SHALL verify that `BoardRepository` implements `IBoardRepository` and all methods are present.

#### Scenario: BR-1 Interface defines all 4 methods
- **WHEN** the `IBoardRepository` interface is inspected at compile time
- **THEN** it declares `listByWorkspace`, `getById`, `exists`, and `getWorkspaceKey`

#### Scenario: BR-2 BoardRepository satisfies IBoardRepository
- **WHEN** `new BoardRepository(db)` is assigned to `IBoardRepository`
- **THEN** TypeScript compiles without errors

### Requirement: listByWorkspace
The test suite SHALL verify that `listByWorkspace` returns boards scoped to the given workspace key.

#### Scenario: BR-3 Returns boards for workspace
- **WHEN** workspace "default" has boards with id=1 (name="Board A") and id=2 (name="Board B")
- **THEN** `repo.listByWorkspace("default")` returns an array of two objects with id and name

#### Scenario: BR-4 Returns empty array for empty workspace
- **WHEN** workspace "empty" has no boards
- **THEN** `repo.listByWorkspace("empty")` returns `[]`

#### Scenario: BR-5 Orders by created_at ascending
- **WHEN** workspace has boards created at different times
- **THEN** `repo.listByWorkspace` returns boards ordered by `created_at ASC`

#### Scenario: BR-6 Cross-workspace isolation
- **WHEN** workspace "ws1" has board #1 and workspace "ws2" has board #2
- **THEN** `repo.listByWorkspace("ws1")` returns only board #1, not board #2

### Requirement: getById
The test suite SHALL verify that `getById` returns board data or null.

#### Scenario: BR-7 Returns board data for known id
- **WHEN** board with id=1 exists with name="Test" and workspace_key="default"
- **THEN** `repo.getById(1)` returns `{ id: 1, name: "Test", workspaceKey: "default" }`

#### Scenario: BR-8 Returns null for unknown id
- **WHEN** no board with id=999 exists
- **THEN** `repo.getById(999)` returns `null`

### Requirement: exists
The test suite SHALL verify that `exists` returns a boolean.

#### Scenario: BR-9 Returns true for known board
- **WHEN** board with id=1 exists
- **THEN** `repo.exists(1)` returns `true`

#### Scenario: BR-10 Returns false for unknown board
- **WHEN** no board with id=999 exists
- **THEN** `repo.exists(999)` returns `false`

### Requirement: getWorkspaceKey
The test suite SHALL verify that `getWorkspaceKey` returns the workspace key or null.

#### Scenario: BR-11 Returns workspace key for known board
- **WHEN** board with id=1 has workspace_key="my-ws"
- **THEN** `repo.getWorkspaceKey(1)` returns `"my-ws"`

#### Scenario: BR-12 Returns null for unknown board
- **WHEN** no board with id=999 exists
- **THEN** `repo.getWorkspaceKey(999)` returns `null`
