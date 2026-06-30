## 1. ExecutionParamsBuilder — thread workspaceKey

- [ ] 1.1 Add `workspaceKey?: string` as last optional parameter to `ExecutionParamsBuilder.build()`
- [ ] 1.2 Return `workspaceKey` in the `ExecutionParams` object from `build()`

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

## 5. Test helpers — multi-workspace support

- [ ] 5.1 `helpers.ts`: `seedProjectAndTask(db, gitRoot, { workspaceKey?: string })` — optional workspaceKey param
- [ ] 5.2 `backend-rpc-runtime.ts`: `createTask(model?, { workspaceKey?: string })` — optional workspaceKey param
- [ ] 5.3 `cursor/mocks.ts`: `MockCursorSdkAdapter` captures `workspaceKey` in runConfig trace

## 6. Unit tests

- [ ] 6.1 `execution-params-builder.test.ts`: +3 scenarios (build() returns workspaceKey, undefined when omitted, buildForChat unchanged)
- [ ] 6.2 `transition-executor.test.ts`: +2 scenarios (task board workspaceKey flows to params)
- [ ] 6.3 `human-turn-executor.test.ts`: +1 scenario (human turn preserves task workspaceKey)
- [ ] 6.4 `retry-executor.test.ts`: +1 scenario (retry preserves task workspaceKey)
- [ ] 6.5 `multi-engine-execution.test.ts`: +3 scenarios (copilot/claude/opencode receive correct workspaceKey)

## 7. Integration tests

- [ ] 7.1 `workspace-key-propagation.test.ts` (new): +3 scenarios (full pipeline: transition/human-turn/retry → engine)

## 8. Guard tests

- [ ] 8.1 `common-tools-guard.test.ts` (new): +2 scenarios (warning fires on default wsKey; silent on correct)

## 9. Verification

- [ ] 9.1 Run `bun test src/bun` — all tests pass
- [ ] 9.2 Verify `list_projects` returns correct workspace data for non-default workspace task
- [ ] 9.3 Verify `list_workflows` returns correct workspace data for non-default workspace task
- [ ] 9.4 Verify chat sessions still work (no regression on buildForChat path)
