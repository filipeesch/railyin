## workspaceKey Propagation — Test Plan

### Decisions
- Guard test: NEW FILE (not modify existing files)
- No Playwright tests for this change
- Add workspaceKey capture to MockCursorSdkAdapter

### Test Plan (refined)

#### 1. Unit Tests (in-memory DB, vitest)

**execution-params-builder.test.ts** (+3)
- EPB-WK-3: build() returns workspaceKey when passed
- EPB-WK-4: build() returns undefined when not passed (optional)
- EPB-WK-5: buildForChat() not affected (regression)

**transition-executor.test.ts** (+2)
- TE-WK-1: Transition uses task's board workspaceKey
- TE-WK-2: Transition with non-default workspace key

**human-turn-executor.test.ts** (+1)
- HT-WK-1: Human turn uses task's board workspaceKey

**retry-executor.test.ts** (+1)
- RT-WK-1: Retry uses task's board workspaceKey

**multi-engine-execution.test.ts** (+3)
- ME-WK-1: params.workspaceKey = board's workspace (copilot)
- ME-WK-2: params.workspaceKey = board's workspace (claude)
- ME-WK-3: params.workspaceKey = board's workspace (opencode)

#### 2. Integration Tests (new file)

**workspace-key-propagation.test.ts** (new, +3)
- WKP-1: Full pipeline — transition → engine receives correct workspaceKey
- WKP-2: Human turn pipeline — engine receives correct workspaceKey
- WKP-3: Retry pipeline — engine receives correct workspaceKey

**helpers.ts** (+1)
- seedProjectAndTask(db, gitRoot, { workspaceKey?: string }) — optional workspaceKey param

**backend-rpc-runtime.ts** (+1)
- createTask(model?, workspaceKey?) — optional workspaceKey param

**cursor/mocks.ts** (+1)
- MockCursorSdkAdapter: add runConfig.trace.workspaceKey capture

#### 3. Guard Test (new file)

**common-tools-guard.test.ts** (new, +2)
- GUARD-1: Warning logs when workspaceKey === getDefaultWorkspaceKey()
- GUARD-2: No warning when workspaceKey is different

### Summary
Total: ~20 scenarios across unit + integration + guard tests
