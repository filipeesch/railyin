## Context

`src/bun/git/worktree.ts` is a flat module of free functions that use global `getDb()` and `getConfig()` singletons. The core bug — worktrees branching from `HEAD` instead of `project.defaultBranch` — exists because `createWorktree()` has no access to project config: `defaultBranch` lives in the config layer but never flows into worktree creation. The broader problem is that the module cannot be refactored incrementally without first breaking its global dependencies.

Callers in `tasks.ts` and `task-git.ts` import free functions directly. Tests in `worktree.test.ts` interact with the module through its globals, making stubs impossible.

## Goals / Non-Goals

**Goals:**
- Fix: auto-created worktrees branch from `project.defaultBranch`, not `HEAD`
- Introduce DI-injectable classes for all worktree and git-subprocess concerns
- Separate concerns: DB persistence (`TaskGitContextRepository`), git subprocesses (`GitRepositoryManager`), task orchestration (`WorktreeManager`)
- Remove global `getDb()` and `getConfig()` usage from the git layer
- Update all callers to receive services via constructor/function injection

**Non-Goals:**
- Changes to the `task_git_context` DB schema (no migrations)
- Changes to the RPC API surface (`tasks.createWorktree`, `tasks.listBranches`, etc.)
- Fixing `subrepo_path` not being passed by callers (dead column, separate concern)
- Adding new git capabilities beyond what exists today

## Decisions

### D1: Two-layer git architecture

**Decision:** Split git logic into two classes: `GitRepositoryManager` (pure subprocess layer) and `WorktreeManager` (task orchestration layer).

`GitRepositoryManager` operates on paths (`gitRootPath`, `worktreePath`) with no DB access. `WorktreeManager` operates on `taskId`, looks up state via `TaskGitContextRepository` and project config via `IProjectResolver`, then delegates all git operations to `GitRepositoryManager`.

**Alternative considered:** One class `WorktreeManager` doing everything. Rejected because it conflates two different abstraction levels and makes the git subprocess logic untestable in isolation.

### D2: IGitBinaryResolver interface

**Decision:** Extract `resolveGit()` into `IGitBinaryResolver` with method `resolvePath(): string`, implemented by `GitBinaryResolver`. Both `GitRepositoryManager` and (transitively) `WorktreeManager` receive it via injection.

**Alternative considered:** Keep `resolveGit()` as a private method on `WorktreeManager`. Rejected because the user explicitly requested the abstraction for test isolation — a mock resolver can return a test git path without PATH scanning.

### D3: IProjectResolver interface

**Decision:** Introduce `IProjectResolver` with `getDefaultBranch(workspaceKey, projectKey): string`, implemented by `ProjectResolver` wrapping `getLoadedProjectByKey`. `WorktreeManager` depends on this interface.

**Rationale:** Interface Segregation — `WorktreeManager` only needs the default branch, not the full `LoadedProject` shape. The narrow interface is trivially stub-able in tests.

### D4: TaskGitContextRepository in src/bun/db/repositories/

**Decision:** Encapsulate all `task_git_context` reads and writes in `TaskGitContextRepository`. `WorktreeManager` depends on `ITaskGitContextRepository`.

**Rationale:** Consistent with existing pattern (`WorkspaceRepository`, `TaskRepository`, `DecisionRepository`). Removes raw `db.query()` / `db.run()` calls scattered through `worktree.ts`.

### D5: Delete worktree.ts, update callers directly

**Decision:** Remove `src/bun/git/worktree.ts` entirely. Update `tasks.ts` and `task-git.ts` to accept `WorktreeManager` (and `GitRepositoryManager` for `listBranches`) as parameters.

**Alternative considered:** Keep `worktree.ts` as a shim using global singletons. Rejected — it would preserve the exact coupling we're trying to remove and leave dead code.

### D6: The fix — how defaultBranch flows

In `WorktreeManager.createWorktree()` when called without explicit options (auto-creation path):
1. Query `tasks.project_key` for `taskId`
2. Call `wsRepo.getTaskWorkspaceKey(taskId)` to get workspace key
3. Call `projectResolver.getDefaultBranch(wsKey, projectKey)` → e.g. `"main"`
4. Pass as `sourceBranch` to `gitRepo.addWorktree(gitRootPath, branch, worktreePath, "main")`

Previously step 4 used `"HEAD"` unconditionally.

## Risks / Trade-offs

- **Handler signatures change** → All call sites in `index.ts` must be updated. Risk: missing a call site. Mitigation: TypeScript will catch it at compile time.
- **Test rewrites** → `worktree.test.ts` constructs the class with injected dependencies instead of calling free functions. Risk: tests miss coverage gaps during rewrite. Mitigation: keep all existing test cases, add one for the default-branch fix.
- **IWorkspaceRepository already injected into tasks.ts** → `WorktreeManager` also needs it. Since `index.ts` already constructs `WorkspaceRepository`, this is passed through without new instantiation.

## Migration Plan

No data migrations. No API changes. Deployment is drop-in: old module deleted, new classes wired at `index.ts`. Rollback is reverting the commit.

## Open Questions

None — all decisions resolved during exploration.
