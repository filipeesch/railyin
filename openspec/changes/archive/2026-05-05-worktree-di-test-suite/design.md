## Context

The `fix-worktree-base-branch` change introduces three new classes and two interfaces to replace the global-singleton `worktree.ts` module. The existing `worktree.test.ts` tests free functions against `getDb()` / `getConfig()` globals — those tests will break once the module is deleted. This change migrates and extends the test suite to verify each new class boundary in isolation, using DI stubs as the primary mock mechanism.

All tests that touch the file system use real git in temp directories — consistent with the existing test infrastructure. Tests that only need DB behavior use in-memory SQLite via `initDb()`.

## Goals / Non-Goals

**Goals:**
- Migrate all existing `worktree.test.ts` test cases to `WorktreeManager` class API
- Add the critical regression test: auto-creation uses `project.defaultBranch`, not `HEAD`
- Full unit coverage of `TaskGitContextRepository`, `ProjectResolver`, `GitRepositoryManager`
- Handler integration tests for `task-git.ts` using injected `WorktreeManager`

**Non-Goals:**
- Changes to production code (test-only change)
- Playwright/UI tests — worktree branch source is invisible at the UI layer
- Mutation testing coverage (separate concern)

## Decisions

### TD-1: Stub IProjectResolver in WorktreeManager tests

`IProjectResolver` is injected via constructor — tests create a plain object literal implementing the two methods. This avoids filesystem config reads in tests that exercise `WorktreeManager` logic.

**For getDefaultBranch:** return a fixed string (e.g. `"main"`) — simple synchronous stub.
**For getWorktreeBasePath:** return the `worktreesBase` temp dir created in `beforeEach` — this is the meaningful value since it determines where worktrees land on disk.

### TD-2: Real git for GitRepositoryManager and WorktreeManager tests

`GitRepositoryManager` uses real git subprocesses by design (no injectable binary). Tests create real temp git repos (`git init`, commit, etc.) — consistent with the existing test infrastructure in `worktree.test.ts` and `task-git-handlers.test.ts`.

**Alternative considered:** Mock `Bun.spawn`. Rejected — it requires patching a global and couples tests to implementation internals.

### TD-3: TaskGitContextRepository tested with in-memory DB only

No git required — these are pure SQL tests. `initDb()` provides the schema; tests verify insert/update/select behavior directly.

### TD-4: ProjectResolver tested via setupTestConfig

`ProjectResolver` reads from the loaded config layer. Tests use `setupTestConfig(extraYaml)` (which already sets `default_branch: main`) to exercise `getDefaultBranch`. For `getWorktreeBasePath`, tests write `worktree_base_path` into the workspace YAML and verify the resolver returns it — and verify the fallback when omitted.

### TD-5: Handler tests use WorktreeManager constructed with stubs

`task-git-handlers.test.ts` currently calls `registerProjectGitContext` directly. After the refactor it must construct `WorktreeManager` with stubs and pass it to `taskGitHandlers`. This keeps the handler tests isolated from git subprocess execution.

## Risks / Trade-offs

- **Migration risk** — existing tests stop compiling the moment `worktree.ts` is deleted. This change must ship together with the implementation change. Mitigation: keep both changes in the same PR.
- **Test isolation for GitRepositoryManager** — real git subprocesses are slower (~1-3s per test). The existing test suite already accepts this tradeoff; same timeouts apply.
