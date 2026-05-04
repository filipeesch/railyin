# Workspace Repository Tests

## Purpose

Test coverage for the `WorkspaceRepository` class verifying all DB scenarios using an in-memory database via `initDb()`.

## Requirements

### Requirement: workspace-repository.test.ts covers all DB scenarios
The test file `src/bun/test/workspace-repository.test.ts` SHALL exist and cover the `WorkspaceRepository` class using an in-memory DB via `initDb()`. It SHALL NOT require `setupTestConfig()`.

#### Scenario: WR-1 getBoardWorkspaceKey returns stored key
- **WHEN** a board row with `workspace_key='myworkspace'` exists in the in-memory DB
- **THEN** `wsRepo.getBoardWorkspaceKey(boardId)` returns `'myworkspace'`

#### Scenario: WR-2 getBoardWorkspaceKey falls back to default for unknown board
- **WHEN** no board with the given id exists in the DB
- **THEN** `wsRepo.getBoardWorkspaceKey(999)` returns the value of `getDefaultWorkspaceKey()`

#### Scenario: WR-3 getTaskWorkspaceKey returns key via board join
- **WHEN** a task row exists joined to a board with `workspace_key='ws2'`
- **THEN** `wsRepo.getTaskWorkspaceKey(taskId)` returns `'ws2'`

#### Scenario: WR-4 getTaskWorkspaceKey falls back to default for unknown task
- **WHEN** no task with the given id exists in the DB
- **THEN** `wsRepo.getTaskWorkspaceKey(999)` returns the value of `getDefaultWorkspaceKey()`

#### Scenario: WR-5 interface contract is satisfied
- **WHEN** `const r: IWorkspaceRepository = new WorkspaceRepository(db)` is evaluated
- **THEN** TypeScript compiles without errors
