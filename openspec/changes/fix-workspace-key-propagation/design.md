## Context

`list_projects` and `list_workflows` are workspace-scoped tools that filter data by `ctx.workspaceKey`. This context comes from `CommonToolContext`, which each engine constructs from `ExecutionParams`.

### Current State (Bug)

For **chat sessions**: `buildForChat()` accepts and returns `workspaceKey` → engines read it correctly → tools filter by the session's workspace. ✅

For **task executions**: `build()` does NOT accept `workspaceKey` → engines get `params.workspaceKey === undefined` → all engines fall back to `getDefaultWorkspaceKey()` (first workspace in registry) → tools always show first workspace data. ❌

```
┌──────────────────────────────────────────────────────────┐
│              BUG FLOW (Task Execution)                    │
├──────────────────────────────────────────────────────────┤
│  TransitionExecutor.execute()                             │
│    workspaceKey = wsRepo.getTaskWorkspaceKey(taskId) ✅  │
│    ↓                                                      │
│    paramsBuilder.build(..., workspaceKey?) ❌ NOT PASSED │
│    ↓                                                      │
│    ExecutionParams.workspaceKey = undefined ❌           │
│    ↓                                                      │
│    Copilot/Claude/Pi/OpenCode:                            │
│      workspaceKey ?? getDefaultWorkspaceKey()             │
│      → defaults to first workspace ❌                    │
│    ↓                                                      │
│    Cursor:                                                │
│      getDefaultWorkspaceKey()  ❌ (hardcoded)            │
│    ↓                                                      │
│    CommonToolContext.workspaceKey = "default" ❌         │
│    ↓                                                      │
│    list_projects → filters by "default" ❌               │
└──────────────────────────────────────────────────────────┘
```

### Constraints
- Chat sessions already work correctly — do not change that path
- `ExecutionParams.workspaceKey` is already typed as optional (`workspaceKey?: string`)
- All 4 executors already resolve `workspaceKey` locally before calling `build()`
- User constraint: NEVER fallback to `getDefaultWorkspaceKey()` — we are ALWAYS in a workspace context

## Goals / Non-Goals

**Goals:**
- Thread `workspaceKey` through `build()` so task executions carry the correct workspace
- Fix all 5 engines to use `params.workspaceKey` directly (no fallback)
- Add a runtime guard that warns when `ctx.workspaceKey` equals the default workspace
- Preserve chat session behavior (already correct)

**Non-Goals:**
- Testing (handled separately)
- Changing `getDefaultWorkspaceKey()` behavior
- Modifying workspace config loading or registry

## Decisions

### D1: Thread `workspaceKey` through `ExecutionParamsBuilder.build()`

**Decision**: Add `workspaceKey` as an optional trailing parameter to `build()`, return it in the resulting `ExecutionParams`.

**Rationale**: Mirrors the existing `buildForChat()` pattern. `buildForChat()` already takes `workspaceKey` as the 6th positional param and returns it. Adding it to `build()` creates symmetry.

**Alternatives considered**:
- *Inject via enricher*: Would mix concerns — enricher handles model overrides, not workspace routing
- *Set on executors directly*: Adds state to executor classes, violates the current pure-pattern

### D2: All engines use `params.workspaceKey` directly

**Decision**: Remove `?? getDefaultWorkspaceKey()` fallback from ALL engines (Copilot, Claude, Pi, OpenCode, Cursor). Use `params.workspaceKey` as-is.

**Rationale**: User stated "we are ALWAYS in a context of a workspace." A fallback to default is a code smell — if `workspaceKey` is missing, it's a bug that should surface, not silently mask.

**Alternatives considered**:
- *Keep fallback*: Masks bugs but risks silently using wrong workspace. User explicitly rejected this.

### D3: Runtime guard in `common-tools.ts`

**Decision**: Add a `console.warn()` in `executeCommonToolText()` when `ctx.workspaceKey === getDefaultWorkspaceKey()`.

**Rationale**: Provides a safety net during and after deployment. If any executor fails to pass the correct workspaceKey, the warning will appear in server logs. This is non-blocking — it's a diagnostic, not a failure.

**Alternatives considered**:
- *Throw error*: Too aggressive for a guard — would break existing behavior during transition
- *No guard*: No protection against future regressions

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| `build()` signature change breaks callers | Medium | `workspaceKey` is optional trailing param — existing callers without it still compile. All 4 executors will be updated. |
| An executor passes `undefined` workspaceKey | High | Guard catches it in logs. All 4 executors already resolve it before `build()` call — verified. |
| Cursor engine was already hardcoded | Low | This was the confirmed bug — fixing it is the primary goal. |
| Chat session path unchanged | None | `buildForChat()` already handles this correctly. |

## Migration Plan

This is an in-code change with no data migration. Deployment:
1. Deploy the code change
2. Monitor server logs for the workspace guard warning
3. Verify task executions use correct workspace by checking `list_projects`/`list_workflows` output

**Rollback**: Revert the commit — no data impact.

## Open Questions

None. All executors verified to have `workspaceKey` resolved before calling `build()`.
