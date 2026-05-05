## ADDED Requirements

### Requirement: Git operations are injectable
The system SHALL expose git subprocess operations through an `IGitBinaryResolver` interface (single method `resolvePath(): string`) and a `GitRepositoryManager` class that accepts it via constructor injection. Tests SHALL be able to substitute a mock `IGitBinaryResolver` without modifying production code.

#### Scenario: Mock git binary in tests
- **WHEN** tests construct `GitRepositoryManager` with a stub `IGitBinaryResolver`
- **THEN** all git subprocess calls use the stub-provided binary path and no PATH scanning occurs

### Requirement: Project default branch is injectable
The system SHALL expose project config access through an `IProjectResolver` interface (single method `getDefaultBranch(workspaceKey, projectKey): string`). `WorktreeManager` SHALL accept `IProjectResolver` via constructor injection.

#### Scenario: Stub project resolver in tests
- **WHEN** tests construct `WorktreeManager` with a stub `IProjectResolver` returning `"main"`
- **THEN** worktree creation uses `"main"` without reading workspace.yaml from disk

### Requirement: Task git context is encapsulated
The system SHALL expose all `task_git_context` reads and writes through a `TaskGitContextRepository` class. No other class SHALL issue raw SQL queries against the `task_git_context` table.

#### Scenario: Context accessed only through repository
- **WHEN** `WorktreeManager` needs the git root path for a task
- **THEN** it calls `taskGitContextRepository.getContext(taskId)` and does not issue a raw db.query

### Requirement: Worktree lifecycle is orchestrated by WorktreeManager
The system SHALL provide a `WorktreeManager` class that owns the task-level worktree lifecycle: `registerContext`, `createWorktree`, `removeWorktree`, and `triggerWorktreeIfNeeded`. All callers in `tasks.ts` and `task-git.ts` SHALL receive `WorktreeManager` via function parameter injection, not direct module imports.

#### Scenario: Handler receives WorktreeManager via injection
- **WHEN** `taskHandlers` is initialised
- **THEN** it accepts a `WorktreeManager` parameter and uses it without importing from worktree.ts

### Requirement: Git repository operations are in GitRepositoryManager
The system SHALL provide a `GitRepositoryManager` class for path-based git operations: `addWorktree`, `removeWorktree`, `revParseHead`, and `listBranches`. This class SHALL have no database dependency and SHALL not accept taskIds.

#### Scenario: addWorktree accepts path arguments directly
- **WHEN** `gitRepositoryManager.addWorktree(gitRootPath, branch, worktreePath, sourceBranch)` is called
- **THEN** it executes `git worktree add -b <branch> <worktreePath> <sourceBranch>` in `gitRootPath`

### Requirement: worktree.ts module is removed
The system SHALL NOT contain the file `src/bun/git/worktree.ts` after this change. All functionality SHALL be accessed through the new classes.

#### Scenario: Build succeeds without worktree.ts
- **WHEN** the project is built after this change
- **THEN** TypeScript compilation succeeds with no references to `src/bun/git/worktree.ts`
