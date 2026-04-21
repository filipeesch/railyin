## 1. RPC Types

- [x] 1.1 Add `tasks.listBranches` RPC type to `src/shared/rpc-types.ts`
- [x] 1.2 Add `tasks.createWorktree` RPC type to `src/shared/rpc-types.ts`
- [x] 1.3 Add `tasks.removeWorktree` RPC type to `src/shared/rpc-types.ts`

## 2. Backend — Git utilities

- [x] 2.1 Add optional `options` parameter to `createWorktree()` in `src/bun/git/worktree.ts` supporting `mode`, `branchName`, `path`, and `sourceBranch`
- [x] 2.2 Add `listBranches(taskId)` function to `src/bun/git/worktree.ts` that runs `git branch -a --format=%(refname:short)` and filters out HEAD refs
- [x] 2.3 Update `triggerWorktreeIfNeeded()` in `src/bun/git/worktree.ts` to retry when `worktree_status` is `removed` (in addition to `not_created` and `error`)

## 3. Backend — RPC handlers

- [x] 3.1 Wire `tasks.listBranches` handler in `src/bun/handlers/tasks.ts`
- [x] 3.2 Wire `tasks.createWorktree` handler in `src/bun/handlers/tasks.ts` (call extended `createWorktree()`, broadcast updated Task via WS)
- [x] 3.3 Wire `tasks.removeWorktree` handler in `src/bun/handlers/tasks.ts` (call `removeWorktree()`, set status `removed`, broadcast updated Task via WS)

## 4. Frontend — TaskInfoTab redesign

- [x] 4.1 Replace read-only worktree section in `src/mainview/components/TaskInfoTab.vue` with state-driven template (ready / creating / missing / error)
- [x] 4.2 Implement delete button + inline confirmation in the `ready` state
- [x] 4.3 Implement inline create form (new branch mode) with branch name input, source branch dropdown, and path input
- [x] 4.4 Implement existing branch mode toggle and branch dropdown in the create form
- [x] 4.5 Implement Retry button that expands the create form in the `error` state
- [x] 4.6 Add `createWorktree` and `removeWorktree` emits to `TaskInfoTab` and handle them in `TaskDetailDrawer`

## 5. Frontend — TaskDetailDrawer wiring

- [x] 5.1 Add `tasks.listBranches` call in `TaskDetailDrawer.vue` triggered when the create form opens
- [x] 5.2 Handle `createWorktree` emit: call `tasks.createWorktree`, manage loading state, handle errors
- [x] 5.3 Handle `removeWorktree` emit: call `tasks.removeWorktree`, manage loading state, show warning if returned

## 6. Tests

- [x] 6.1 Write and run e2e tests for worktree management UI
