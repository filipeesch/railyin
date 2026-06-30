## 1. ExecutionParamsBuilder — thread workspaceKey

- [ ] 1.1 Add `workspaceKey?: string` as last optional parameter to `ExecutionParamsBuilder.build()`
- [ ] 1.2 Return `workspaceKey` in the `ExecutionParams` object from `build()`
- [ ] 1.3 Verify `buildForChat()` still works unchanged (no regression)

## 2. Executors — pass workspaceKey to build()

- [ ] 2.1 `transition-executor.ts`: Pass `workspaceKey` as last argument to `paramsBuilder.build()`
- [ ] 2.2 `human-turn-executor.ts`: Pass `workspaceKey` to both `paramsBuilder.build()` call sites
- [ ] 2.3 `retry-executor.ts`: Pass `workspaceKey` to `paramsBuilder.build()`
- [ ] 2.4 `code-review-executor.ts`: Pass `workspaceKey` to `paramsBuilder.build()`

## 3. Engines — use params.workspaceKey directly (no fallback)

- [ ] 3.1 `copilot/engine.ts`: Change `workspaceKey: workspaceKey ?? getDefaultWorkspaceKey()` → `workspaceKey: params.workspaceKey`
- [ ] 3.2 `cursor/engine.ts`: Destructure `workspaceKey` from params, change `workspaceKey: getDefaultWorkspaceKey()` → `workspaceKey: params.workspaceKey`
- [ ] 3.3 `claude/engine.ts`: Change `workspaceKey: workspaceKey ?? getDefaultWorkspaceKey()` → `workspaceKey: params.workspaceKey`
- [ ] 3.4 `pi/engine.ts`: Change `workspaceKey: workspaceKey ?? getDefaultWorkspaceKey()` → `workspaceKey: params.workspaceKey`
- [ ] 3.5 `opencode/engine.ts`: Change `workspaceKey: workspaceKey ?? getDefaultWorkspaceKey()` → `workspaceKey: params.workspaceKey`

## 4. Runtime guard

- [ ] 4.1 Add `console.warn()` in `executeCommonToolText()` when `ctx.workspaceKey === getDefaultWorkspaceKey()`
- [ ] 4.2 Guard message includes tool name and execution type (task vs chat) for debugging

## 5. Verification

- [ ] 5.1 Run `bun test src/bun` to check for compilation/runtime errors
- [ ] 5.2 Verify `list_projects` returns correct workspace data for a non-default workspace task
- [ ] 5.3 Verify `list_workflows` returns correct workspace data for a non-default workspace task
- [ ] 5.4 Verify chat sessions still work (no regression on `buildForChat()` path)
