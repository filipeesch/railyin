## Context

Tasks in Railyin use git worktrees to provide isolated working directories — each task gets its own branch and directory so the AI agent's file edits don't touch the main repo. The worktree path is stored in `task_git_context.worktree_path` and set to `ready` once created.

The orchestrator's `_resolveWorkingDirectory()` determines which directory is passed to the engine as `workingDirectory`. A previous fix introduced a regression: `projectPath` was made to always win over `worktree_path` to fix slash command resolution in monorepo setups. The result is that every task execution runs in the main project directory instead of the isolated worktree.

## Goals / Non-Goals

**Goals:**
- Tasks with a ready worktree execute inside that worktree
- Monorepo sub-project layout is preserved within the worktree (slash commands keep working)
- Tasks without a worktree (still in Backlog / `not_created`) continue using `projectPath` as CWD
- Misconfiguration (projectPath outside gitRootPath) produces a clear error

**Non-Goals:**
- Changes to worktree creation logic
- Changes to how the engine resolves slash commands (already correct via `listCommands`)
- Support for tasks with no `projectPath` and no worktree (already throws — unchanged)

## Decisions

### Decision: Compute sub-path at resolution time, not at registration time

**Choice**: In `_resolveWorkingDirectory()`, compute `relative(gitRootPath, projectPath)` and `join(worktree_path, relSubPath)` on the fly when a worktree is ready.

**Alternatives considered**:
- *Store `subrepo_path` at registration time (Strategy B)*: The column already exists but is never populated. This would require changing 3 `registerProjectGitContext` call sites, adding a migration/backfill, and more test surface. The runtime computation is cheap and equivalent.
- *Split `engineCwd` vs `toolsCwd` (Strategy C)*: Correct semantically but requires changing `ExecutionParams`, all engine adapters, and `ToolContext`. Disproportionate for a one-line logical fix.

**Rationale**: Strategy A touches one function. The path relationship between `gitRootPath` and `projectPath` is stable config data that doesn't need to be persisted.

### Decision: Priority order when worktree is ready

```
When worktree_status = 'ready':
  relSubPath = relative(gitRootPath, projectPath)
  if relSubPath starts with '..' → throw (misconfiguration)
  return join(worktree_path, relSubPath)

When worktree_status ≠ 'ready' (or no git context row):
  if projectPath configured → return projectPath
  throw "Project directory not found"
```

This ensures:
- **Single-repo** (`projectPath == gitRootPath`): `relSubPath = ""` → `cwd = worktree_path` ✅  
- **Monorepo** (`projectPath = /repo/packages/app`, `gitRootPath = /repo`): `relSubPath = "packages/app"` → `cwd = /wt/task-1/packages/app` ✅  
- **Pre-worktree** (task just created, still in backlog): falls through to `projectPath` ✅

### Decision: Update existing orchestrator test, not replace it

The existing test `"uses projectPath over worktree_path when both are configured"` must be **inverted** — it was the regression test for the wrong fix. The new assertion is that when both are configured AND the worktree is ready, the resolved CWD is the **worktree path** (with sub-path for monorepo). The test description is updated accordingly.

## Risks / Trade-offs

- **`relative()` with paths on different drives (Windows)**: `node:path.relative()` returns an absolute path or `..` prefix when drives differ. The `..` guard covers this.
- **`projectPath` not set in config**: Unchanged behavior — falls through to `worktree_path` directly (no relative computation needed).
- **Existing sessions in flight**: No migration needed; the change is purely runtime logic with no DB schema impact.

## Open Questions

- None — the fix is well-scoped and the existing test infrastructure covers all branches.
