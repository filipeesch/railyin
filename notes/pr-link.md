## PR: fix-workspace-key-propagation

**PR #87**: https://github.com/filipeesch/railyin/pull/87

**Branch**: `task/494-list-project-anmd-workflows-issue`

**What**: Fix `list_projects` and `list_workflows` always returning data from the first/default workspace instead of the task's workspace.

**Root cause**: `workspaceKey` never threaded through `ExecutionParamsBuilder.build()` for task executions. All engines fall back to `getDefaultWorkspaceKey()`.

**Changes**:
- Add `workspaceKey` to `build()` and return it in `ExecutionParams`
- Update 4 executors to pass `workspaceKey`
- Fix 5 engines to use `params.workspaceKey` directly (no fallback)
- Add runtime guard warning in `common-tools.ts`
- ~20 test scenarios (unit + integration + guard)

**Files**: 11 production + 7 test files
