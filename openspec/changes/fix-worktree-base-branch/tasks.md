## 1. Interfaces and foundation

- [ ] 1.1 Create `src/bun/git/IProjectResolver.ts` — interface with `getDefaultBranch(workspaceKey: string, projectKey: string): string` and `getWorktreeBasePath(workspaceKey: string, projectKey: string, gitRootPath: string): string`
- [ ] 1.2 Create `src/bun/git/ProjectResolver.ts` — production implementation: `getDefaultBranch` wraps `getLoadedProjectByKey`; `getWorktreeBasePath` reads `workspace.worktree_base_path ?? \`${gitRootPath}/../worktrees\``
- [ ] 1.3 Create `src/bun/db/repositories/ITaskGitContextRepository.ts` — interface for `task_git_context` access
- [ ] 1.4 Create `src/bun/db/repositories/TaskGitContextRepository.ts` — encapsulates all raw SQL against `task_git_context`

## 2. GitRepositoryManager

- [ ] 2.1 Create `src/bun/git/GitRepositoryManager.ts` with no constructor parameters; private `resolveGit(): string` method (logic migrated from `resolveGit()` in `worktree.ts`)
- [ ] 2.2 Implement `addWorktree(gitRootPath, branch, worktreePath, sourceBranch, mode?)` — migrated from `createWorktree` subprocess logic in `worktree.ts`
- [ ] 2.3 Implement `removeWorktree(gitRootPath, worktreePath)` — migrated from `removeWorktree` in `worktree.ts`
- [ ] 2.4 Implement `revParseHead(worktreePath): Promise<string>` — migrated from existing implementation
- [ ] 2.5 Implement `listBranches(gitRootPath): Promise<string[]>` — migrated from `listBranches` in `worktree.ts`

## 3. WorktreeManager

- [ ] 3.1 Create `src/bun/git/WorktreeManager.ts` with constructor `(db: Database, wsRepo: IWorkspaceRepository, projectResolver: IProjectResolver, gitRepo: GitRepositoryManager, taskGitContextRepo: ITaskGitContextRepository)`
- [ ] 3.2 Implement `registerContext(taskId, gitRootPath, subrepoPath?)` — migrated from `registerProjectGitContext` in `worktree.ts`
- [ ] 3.3 Implement `createWorktree(taskId, options?)` — migrated logic; **when `options.sourceBranch` is absent, call `projectResolver.getDefaultBranch(wsKey, projectKey)` for source branch and `projectResolver.getWorktreeBasePath(wsKey, projectKey, gitRootPath)` for base path**
- [ ] 3.4 Implement `removeWorktree(taskId)` — migrated from `worktree.ts`
- [ ] 3.5 Implement `triggerWorktreeIfNeeded(taskId, onStatus?)` — migrated from `worktree.ts`

## 4. Wiring and caller updates

- [ ] 4.1 Update `src/bun/handlers/tasks.ts` — add `worktreeManager: WorktreeManager` param; replace all `registerProjectGitContext` / `triggerWorktreeIfNeeded` calls
- [ ] 4.2 Update `src/bun/handlers/task-git.ts` — add `worktreeManager: WorktreeManager, gitRepo: GitRepositoryManager` params; replace `listBranches`, `createWorktree`, `removeWorktree` calls
- [ ] 4.3 Update `src/bun/index.ts` — construct `ProjectResolver`, `TaskGitContextRepository`, `GitRepositoryManager`, `WorktreeManager`; pass to `taskHandlers` and `taskGitHandlers`
- [ ] 4.4 Delete `src/bun/git/worktree.ts`

## 5. Build validation

- [ ] 5.1 Verify TypeScript build passes: `bun run build`
