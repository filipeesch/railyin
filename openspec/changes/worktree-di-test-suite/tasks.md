## 1. Repository layer tests

- [ ] 1.1 Create `src/bun/test/task-git-context-repository.test.ts` — tests for `TaskGitContextRepository` using `initDb()`
- [ ] 1.2 Implement test: `upsertContext` creates row with `worktree_status = 'not_created'`
- [ ] 1.3 Implement test: `upsertContext` updates path without resetting existing status
- [ ] 1.4 Implement test: `getContext` returns `null` when no row exists
- [ ] 1.5 Implement test: `getContext` returns full row when it exists

## 2. ProjectResolver tests

- [ ] 2.1 Create `src/bun/test/project-resolver.test.ts` — tests for `ProjectResolver` using `setupTestConfig`
- [ ] 2.2 Implement test: `getDefaultBranch` returns configured `default_branch` value
- [ ] 2.3 Implement test: `getDefaultBranch` falls back to `"main"` when not configured
- [ ] 2.4 Implement test: `getWorktreeBasePath` returns configured `worktree_base_path`
- [ ] 2.5 Implement test: `getWorktreeBasePath` falls back to `${gitRootPath}/../worktrees` when not configured

## 3. GitRepositoryManager tests

- [ ] 3.1 Create `src/bun/test/git-repository-manager.test.ts` — real git in temp repos, no DB
- [ ] 3.2 Implement test: `addWorktree` creates worktree branched from `sourceBranch`; verify HEAD SHA matches
- [ ] 3.3 Implement test: `addWorktree` in `"existing"` mode checks out existing branch without `-b`
- [ ] 3.4 Implement test: `addWorktree` throws when `gitRootPath` does not exist
- [ ] 3.5 Implement test: `listBranches` returns branch names, excludes entries containing `"HEAD"`
- [ ] 3.6 Implement test: `revParseHead` returns 40-character SHA matching HEAD commit
- [ ] 3.7 Implement test: `removeWorktree` removes the worktree from the git graph

## 4. WorktreeManager tests (migrate + extend)

- [ ] 4.1 Rewrite `src/bun/test/worktree.test.ts` — replace free-function imports with `WorktreeManager` constructor; inject stub `IProjectResolver` returning `"main"` / `worktreesBase` temp dir
- [ ] 4.2 Migrate test: `registerContext` creates row with `not_created` status
- [ ] 4.3 Migrate test: `registerContext` updates path without resetting status
- [ ] 4.4 Migrate test: `triggerWorktreeIfNeeded` does nothing when no row exists
- [ ] 4.5 Migrate test: `triggerWorktreeIfNeeded` does nothing when status is `ready`
- [ ] 4.6 Migrate test: `triggerWorktreeIfNeeded` creates worktree and sets status to `ready`
- [ ] 4.7 Migrate test: `worktree_path` is set under `worktree_base_path` after creation
- [ ] 4.8 Migrate test: `triggerWorktreeIfNeeded` retries when status is `error`
- [ ] 4.9 Migrate test: throws and sets `error` status when `git_root_path` is invalid
- [ ] 4.10 **Add regression test**: HEAD on `feature/diverged` → worktree still branches from `"main"` (verify commit SHA equality)
- [ ] 4.11 Add test: explicit `sourceBranch` in options overrides `IProjectResolver.getDefaultBranch`

## 5. Handler integration tests

- [ ] 5.1 Update `src/bun/test/task-git-handlers.test.ts` — construct `WorktreeManager` with stubs; pass via `taskGitHandlers(db, onUpdated, worktreeManager, gitRepo)` injection
- [ ] 5.2 Migrate test: `tasks.listBranches` returns `{ branches: [] }` when no context row
- [ ] 5.3 Migrate test: `tasks.getChangedFiles` returns `[]` when worktree not ready
- [ ] 5.4 Migrate test: `tasks.getChangedFiles` returns untracked files when worktree is ready

## 6. Run and verify

- [ ] 6.1 Run full backend test suite: `bun test src/bun/test --timeout 20000`
- [ ] 6.2 Confirm no regressions vs. pre-change baseline
