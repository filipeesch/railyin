# Workspace Repository

## Purpose

Defines the `IWorkspaceRepository` interface and `WorkspaceRepository` class that provide DB-backed workspace key lookups with constructor injection, replacing the `getDb()`-dependent free functions in `workspace-context.ts`.

## Requirements

### Requirement: IWorkspaceRepository interface
The system SHALL define an `IWorkspaceRepository` interface in `src/bun/db/workspace-repository.ts` with the following methods: `getDefaultWorkspaceKey(): string`, `getBoardWorkspaceKey(boardId: number): string`, and `getTaskWorkspaceKey(taskId: number): string`.

#### Scenario: Interface is injectable
- **WHEN** a class or function declares a parameter of type `IWorkspaceRepository`
- **THEN** any object implementing the interface (including mocks) can be passed without compile errors

### Requirement: WorkspaceRepository class
The system SHALL provide a `WorkspaceRepository` class that implements `IWorkspaceRepository` and receives a `Database` instance via its constructor. It SHALL NOT call `getDb()` internally.

#### Scenario: Constructor injection
- **WHEN** `new WorkspaceRepository(db)` is called with an in-memory DB
- **THEN** subsequent calls to `getBoardWorkspaceKey` or `getTaskWorkspaceKey` query that in-memory DB

#### Scenario: getBoardWorkspaceKey returns workspace key
- **WHEN** a board with `id=5` has `workspace_key='myworkspace'` in the DB
- **THEN** `wsRepo.getBoardWorkspaceKey(5)` returns `'myworkspace'`

#### Scenario: getBoardWorkspaceKey falls back to default
- **WHEN** no board with the given id exists in the DB
- **THEN** `wsRepo.getBoardWorkspaceKey(999)` returns the default workspace key

#### Scenario: getTaskWorkspaceKey returns workspace key via join
- **WHEN** a task with `id=7` belongs to a board with `workspace_key='ws2'`
- **THEN** `wsRepo.getTaskWorkspaceKey(7)` returns `'ws2'`

### Requirement: workspace-context.ts retains pure helpers
The module-level free functions `getDefaultWorkspaceKey()`, `getWorkspaceConfig(key)`, and `runWithWorkspaceKey()` SHALL remain in `workspace-context.ts` unchanged. The DB-touching functions `getBoardWorkspaceKey(boardId)` and `getTaskWorkspaceKey(taskId)` SHALL be removed from `workspace-context.ts` (callers use `WorkspaceRepository` instead).

#### Scenario: Pure helpers still importable
- **WHEN** code imports `{ getDefaultWorkspaceKey }` from `workspace-context.ts`
- **THEN** it compiles and functions correctly without any DB dependency
