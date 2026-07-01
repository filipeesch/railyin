## Why

The `list_projects` and `list_workflows` tools always return data from the first/default workspace instead of the workspace associated with the current task. This occurs because `workspaceKey` is never threaded through `ExecutionParamsBuilder.build()` for task executions, causing all engines to fall back to `getDefaultWorkspaceKey()`. The Cursor engine additionally hardcodes `getDefaultWorkspaceKey()` even though `params.workspaceKey` is available.

## What Changes

### Production Code

- Add `workspaceKey` as a parameter to `ExecutionParamsBuilder.build()` and return it in the resulting `ExecutionParams`
- Update all 4 executors (transition, human-turn, retry, code-review) to pass `workspaceKey` to `build()`
- Fix all 5 engines (Copilot, Claude, Pi, OpenCode, Cursor) to use `params.workspaceKey` directly without falling back to `getDefaultWorkspaceKey()`
- Add a runtime guard in `common-tools.ts` that warns when `ctx.workspaceKey` equals the default workspace key (catches future propagation regressions)

**No breaking API changes** — `build()` gains an optional trailing parameter.

### Test Scenarios

| Layer | File(s) | Scenarios | Coverage |
|-------|---------|-----------|----------|
| **Unit** | `execution-params-builder.test.ts` | +3 | `build()` returns workspaceKey; `buildForChat()` unchanged |
| **Unit** | `transition-executor.test.ts` | +2 | Task board workspaceKey flows to params |
| **Unit** | `human-turn-executor.test.ts` | +1 | Human turn preserves task workspaceKey |
| **Unit** | `retry-executor.test.ts` | +1 | Retry preserves task workspaceKey |
| **Unit** | `multi-engine-execution.test.ts` | +3 | Copilot/Claude/OpenCode all receive correct workspaceKey |
| **Integration** | `workspace-key-propagation.test.ts` (new) | +3 | Full pipeline: transition → engine, human-turn → engine, retry → engine |
| **Integration** | `helpers.ts` | +1 | `seedProjectAndTask()` gains optional `workspaceKey` param |
| **Integration** | `backend-rpc-runtime.ts` | +1 | `createTask()` gains optional `workspaceKey` param |
| **Integration** | `cursor/mocks.ts` | +1 | `MockCursorSdkAdapter` captures `workspaceKey` in runConfig trace |
| **Guard** | `common-tools-guard.test.ts` (new) | +2 | Warning fires on default wsKey; silent on correct wsKey |

**Excluded**: Playwright tests (no change to UI behavior).

## Capabilities

### New Capabilities
<!-- None — this is a bug fix, not a new capability -->

### Modified Capabilities
- `engine-execution-params`: `ExecutionParamsBuilder.build()` now accepts and returns `workspaceKey`. All engines MUST use `params.workspaceKey` directly without falling back to the default.

## Impact

- **Production files**: 11 files (builder, 4 executors, 5 engines, common-tools)
- **Test files**: 3 new files + 4 modified files
- **Behavior change**: Task executions will now correctly scope `list_projects`/`list_workflows` to the task's workspace
- **No public API change**: `build()` signature extends with an optional trailing parameter
- **Risk**: If any executor doesn't have `workspaceKey` resolved, the engine will receive `undefined` — all 4 executors already resolve it locally via `wsRepo.getTaskWorkspaceKey(taskId)`
