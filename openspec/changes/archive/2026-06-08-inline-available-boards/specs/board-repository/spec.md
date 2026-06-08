# Board Repository

## Purpose

Defines the `IBoardRepository` interface and `BoardRepository` class that encapsulate board-related database queries, providing a single source of truth for board data access across the executor and engine layers.

## Requirements

### Requirement: IBoardRepository interface
The system SHALL define an `IBoardRepository` interface with the following methods: `listByWorkspace(workspaceKey: string)`, `getById(id: number)`, `exists(id: number)`, `getWorkspaceKey(boardId: number)`. Each method SHALL accept typed parameters and return strongly-typed results.

#### Scenario: Interface defines listByWorkspace
- **WHEN** the `IBoardRepository` interface is inspected
- **THEN** it declares `listByWorkspace(workspaceKey: string): Array<{ id: number; name: string }>`

#### Scenario: Interface defines getById
- **WHEN** the `IBoardRepository` interface is inspected
- **THEN** it declares `getById(id: number): { id: number; name: string; workspaceKey: string } | null`

#### Scenario: Interface defines exists
- **WHEN** the `IBoardRepository` interface is inspected
- **THEN** it declares `exists(id: number): boolean`

#### Scenario: Interface defines getWorkspaceKey
- **WHEN** the `IBoardRepository` interface is inspected
- **THEN** it declares `getWorkspaceKey(boardId: number): string | null`

### Requirement: BoardRepository implementation
The system SHALL provide a `BoardRepository` class that implements `IBoardRepository`. Its constructor SHALL accept `(db: Database)`. It SHALL NOT call `getDb()` internally.

#### Scenario: Constructor injection replaces getDb()
- **WHEN** `new BoardRepository(db)` is called with an in-memory DB
- **THEN** all methods query that in-memory DB

#### Scenario: listByWorkspace returns boards for workspace
- **WHEN** the workspace "default" has boards with id=1 (name="Board A") and id=2 (name="Board B")
- **THEN** `repo.listByWorkspace("default")` returns an array of two objects with id and name properties

#### Scenario: listByWorkspace returns empty array for empty workspace
- **WHEN** the workspace "empty" has no boards
- **THEN** `repo.listByWorkspace("empty")` returns an empty array

#### Scenario: getById returns board data or null
- **WHEN** a board with id=1 exists
- **THEN** `repo.getById(1)` returns an object with id, name, and workspaceKey properties

#### Scenario: getById returns null for unknown id
- **WHEN** no board with id=999 exists
- **THEN** `repo.getById(999)` returns null

#### Scenario: exists returns true for known board
- **WHEN** a board with id=1 exists
- **THEN** `repo.exists(1)` returns true

#### Scenario: exists returns false for unknown board
- **WHEN** no board with id=999 exists
- **THEN** `repo.exists(999)` returns false

#### Scenario: getWorkspaceKey returns workspace key for known board
- **WHEN** a board with id=1 and workspace_key="default" exists
- **THEN** `repo.getWorkspaceKey(1)` returns "default"

#### Scenario: getWorkspaceKey returns null for unknown board
- **WHEN** no board with id=999 exists
- **THEN** `repo.getWorkspaceKey(999)` returns null

### Requirement: Engines use BoardRepository for workspace key resolution
The system SHALL inject `IBoardRepository` into all engine constructors (ClaudeEngine, CopilotEngine, PiEngine, OpenCodeEngine). Engines SHALL use `boardRepo.getWorkspaceKey(boardId)` instead of executing direct database queries against the boards table.

#### Scenario: Engine constructor accepts BoardRepository
- **WHEN** `new ClaudeEngine(...)` is called
- **THEN** it accepts `boardRepo: IBoardRepository` as a constructor parameter

#### Scenario: Engine uses BoardRepository.getWorkspaceKey
- **WHEN** ClaudeEngine's `listCommands` method is called
- **THEN** it resolves the workspace key via `boardRepo.getWorkspaceKey(boardId)` rather than a direct database query
