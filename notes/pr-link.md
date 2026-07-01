## PR: fix-workspace-key-propagation

**PR #87**: https://github.com/filipeesch/railyin/pull/87

**Branch**: `task/494-list-project-anmd-workflows-issue`

**Status**: ✅ MERGED

**Verification**: All production code verified, typecheck passes, tests pass.

**What was implemented**:
- `ExecutionParamsBuilder.build()` now accepts and returns `workspaceKey`
- All 4 executors (transition, human-turn, retry, code-review) pass `workspaceKey` to `build()`
- All 5 engines (Copilot, Claude, Pi, OpenCode, Cursor) use `params.workspaceKey` directly
- Runtime guard in `common-tools.ts` warns when workspaceKey equals default
- Test helpers extended: `seedProjectAndTask`, `createTask`, `MockCursorSdkAdapter`
- Unit tests added: `execution-params-builder.test.ts` (+2 scenarios)

**Remaining tasks** (for follow-up):
- 6.2-6.5: Unit tests for executors and multi-engine
- 7.1: Integration test file
- 8.1: Guard test file
- 9.1-9.4: Verification
