## Why

Worktrees are currently created branching from `HEAD` of the git root — whatever branch happens to be checked out — instead of the project's configured `default_branch`. This violates the existing spec (`git-worktree`: "The branch is created from the project's `default_branch`") and means task branches diverge from an unpredictable base. The fix requires restructuring `worktree.ts` which today uses global singletons and free functions, making it untestable in isolation and the source of the coupling that caused the bug.

## What Changes

- **Delete** `src/bun/git/worktree.ts` — replaced by properly structured classes
- **Introduce** `IProjectResolver` interface (`getDefaultBranch` + `getWorktreeBasePath`) + `ProjectResolver` implementation
- **Introduce** `GitRepositoryManager` — pure git subprocess layer (worktree add/remove/list, branch list)
- **Introduce** `WorktreeManager` — task-level orchestration (reads task/project state, delegates to `GitRepositoryManager`)
- **Introduce** `TaskGitContextRepository` — encapsulates all DB reads/writes for `task_git_context`
- **Update** `tasks.ts` and `task-git.ts` handlers to receive `WorktreeManager` and `GitRepositoryManager` via DI
- **Update** `index.ts` to construct and wire all new classes
- **Fix** auto-worktree creation to use `project.defaultBranch` instead of `HEAD`

## Capabilities

### New Capabilities

- `worktree-di-refactor`: Internal restructuring of worktree creation into DI-injectable classes with clean layer separation

### Modified Capabilities

- `git-worktree`: The requirement "Branch created from default branch" is already in the spec — implementation now honors it

## Impact

- `src/bun/git/worktree.ts` deleted; all callers updated
- `src/bun/handlers/tasks.ts` and `src/bun/handlers/task-git.ts` signatures change (receive service via DI)
- `src/bun/index.ts` wiring updated
- `src/bun/test/worktree.test.ts` updated to construct class with injected stubs
- No DB migrations required
- No API contract changes (RPC method signatures unchanged)
