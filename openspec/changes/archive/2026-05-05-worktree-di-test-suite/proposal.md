## Why

The `fix-worktree-base-branch` refactor introduces three new classes (`GitRepositoryManager`, `WorktreeManager`, `TaskGitContextRepository`) and two interfaces (`IProjectResolver`, `ITaskGitContextRepository`). The existing `worktree.test.ts` tests free functions against global singletons — they will not cover the new class boundaries, the injected-dependency paths, or the critical default-branch fix scenario. A dedicated test pass is needed to establish full, isolated coverage of every layer.

## What Changes

- **Rewrite** `src/bun/test/worktree.test.ts` — migrate all existing test cases to construct `WorktreeManager` with injected stubs; add the default-branch regression test
- **Add** `src/bun/test/git-repository-manager.test.ts` — unit tests for `GitRepositoryManager` (addWorktree, removeWorktree, listBranches, revParseHead) using real temp git repos
- **Add** `src/bun/test/task-git-context-repository.test.ts` — unit tests for `TaskGitContextRepository` with in-memory DB
- **Add** `src/bun/test/project-resolver.test.ts` — unit tests for `ProjectResolver` (getDefaultBranch, getWorktreeBasePath) using `setupTestConfig`
- **Update** `src/bun/test/task-git-handlers.test.ts` — migrate to inject `WorktreeManager` instead of importing free functions

## Capabilities

### New Capabilities

- `worktree-di-test-coverage`: Unit and integration test coverage for the DI-refactored worktree classes and interfaces

### Modified Capabilities

_(none — no spec-level behavior changes, only test coverage additions)_

## Impact

- All changes are test files only — no production code changes
- Depends on `fix-worktree-base-branch` implementation being complete
- `src/bun/test/worktree.test.ts` replaced (migration, not addition)
- `src/bun/test/task-git-handlers.test.ts` updated
- New test files added: `git-repository-manager.test.ts`, `task-git-context-repository.test.ts`, `project-resolver.test.ts`
