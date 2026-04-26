## 1. Fix Core Working Directory Resolution

- [x] 1.1 In `src/bun/engine/orchestrator.ts`, update `_resolveWorkingDirectory()`: when `worktree_status = 'ready'`, compute `relSubPath = relative(gitRootPath, projectPath)`, guard against `..`-escaping paths, and return `join(worktree_path, relSubPath)`
- [x] 1.2 Keep the `projectPath`-only fallback for tasks where `worktree_status !== 'ready'` (pre-worktree / Backlog tasks)
- [x] 1.3 Add `import { relative, join } from "node:path"` if not already present

## 2. Unit Tests — Orchestrator

- [x] 2.1 Update `"uses projectPath over worktree_path when both are configured"` in `src/bun/test/orchestrator.test.ts`: invert assertion so that when worktree is `ready` + `projectPath` is configured, resolved CWD is `worktree_path` (not `projectPath`)
- [x] 2.2 Add test: monorepo case — `gitRootPath=/repo`, `projectPath=/repo/packages/app`, `worktree_path=/wt/task-1` → resolved CWD = `/wt/task-1/packages/app`
- [x] 2.3 Add test: pre-worktree fallback — `worktree_status = 'not_created'` → resolved CWD = `projectPath`
- [x] 2.4 Add test: misconfigured path — `projectPath` outside `gitRootPath` → throws descriptive error

## 3. Unit Tests — Worktree

- [x] 3.1 Add test in `src/bun/test/worktree.test.ts`: verify `relative(gitRootPath, projectPath)` correctly produces `""` for single-repo and `"packages/app"` for monorepo sub-path

## 4. E2E API Tests

- [x] 4.1 Add `"task worktree CWD isolation"` describe block in `e2e/api/smoke.test.ts`: create task, transition it to trigger worktree creation, execute a `run_command pwd` tool call, assert the reported CWD is inside `worktrees/` path not the project directory

## 5. Playwright UI Tests

- [x] 5.1 Add `e2e/ui/task-execution-cwd.spec.ts`: mock a task with `worktreeStatus: "ready"` + `worktreePath: "/tmp/test-wt"` + `projectPath: "/home/user/repo"`, simulate an execution stream that runs `run_command`, assert the tool output path is inside the worktree, not the project directory
- [x] 5.2 Write and run e2e tests for task working directory isolation
