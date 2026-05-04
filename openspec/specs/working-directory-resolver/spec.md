# Working Directory Resolver

## Purpose

Defines the `IWorkingDirectoryResolver` interface and the refactored `WorkingDirectoryResolver` class that accepts DB and workspace repository via constructor injection, enabling test isolation.

## Requirements

### Requirement: IWorkingDirectoryResolver interface
The system SHALL define an `IWorkingDirectoryResolver` interface in `src/bun/engine/execution/working-directory-resolver.ts` with the single method `resolve(task: TaskRow): string`. All consumers (`Orchestrator`, `TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`) SHALL type their resolver field as `IWorkingDirectoryResolver`, not the concrete class.

#### Scenario: Interface enables stub injection
- **WHEN** a test defines `class StubWorkdirResolver implements IWorkingDirectoryResolver { resolve() { return "/stub"; } }`
- **THEN** it can be passed wherever `IWorkingDirectoryResolver` is expected without compile errors and without inheriting from `WorkingDirectoryResolver`

### Requirement: WorkingDirectoryResolver class accepts db and wsRepo via constructor
`WorkingDirectoryResolver` SHALL implement `IWorkingDirectoryResolver` and accept `(db: Database, wsRepo: IWorkspaceRepository)` via constructor. It SHALL NOT call `getDb()` or `getTaskWorkspaceKey()` internally.

#### Scenario: Constructor injection replaces getDb()
- **WHEN** `new WorkingDirectoryResolver(db, wsRepo)` is called with an in-memory DB
- **THEN** `resolve(task)` queries that in-memory DB for `task_git_context` without touching the production database

#### Scenario: resolve returns worktree path when ready
- **WHEN** a `task_git_context` row exists with `worktree_status='ready'` and a valid `worktree_path`
- **THEN** `resolve(task)` returns the (possibly joined) worktree path

#### Scenario: resolve returns project path when no worktree
- **WHEN** no ready worktree exists but `wsRepo` resolves to a workspace with a configured `projectPath`
- **THEN** `resolve(task)` returns that project path
