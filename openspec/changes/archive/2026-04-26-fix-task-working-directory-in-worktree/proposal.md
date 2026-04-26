## Why

When a task has a ready worktree, the AI agent executes in the main repository directory (`projectPath`) instead of the isolated worktree. This means every file edit lands in the main working tree, directly polluting the repo and completely defeating the purpose of git worktrees.

## What Changes

- **Fix**: `_resolveWorkingDirectory()` in `orchestrator.ts` now returns the worktree path (with the monorepo sub-path preserved) when a worktree is `ready`, falling back to `projectPath` only when no worktree exists yet
- **Monorepo support preserved**: When `projectPath` is a subdirectory of `gitRootPath`, the relative sub-path is computed and appended to the worktree path so slash commands and `.claude/commands/` resolution continue to work correctly
- **Edge case guard**: When `projectPath` is outside `gitRootPath` (misconfiguration), a clear error is thrown rather than producing a path-traversal escape

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `git-worktree`: The "Execution context includes both paths for monorepo" requirement was under-specified — the working directory passed to the execution engine must be derived from `worktree_path + relative(gitRootPath, projectPath)`, not `projectPath` directly. Adding explicit scenarios covering this.

## Impact

- **Backend**: `src/bun/engine/orchestrator.ts` — `_resolveWorkingDirectory()` only
- **Tests**: `src/bun/test/orchestrator.test.ts` — existing test inverted + 3 new cases; `src/bun/test/worktree.test.ts` — new path-resolution tests; `e2e/api/smoke.test.ts` — new worktree CWD isolation suite; `e2e/ui/` — new Playwright spec asserting execution CWD
