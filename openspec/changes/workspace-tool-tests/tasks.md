## 1. Board query extraction tests

- [ ] 1.1 Create `src/bun/db/board-queries.ts` with `listBoardsByWorkspace(db, workspaceKey)` function (extracted from boards handler)
- [ ] 1.2 Write tests: `listBoardsByWorkspace` returns correct boards ordered by creation time
- [ ] 1.3 Write tests: `listBoardsByWorkspace` filters by workspace key
- [ ] 1.4 Write tests: `listBoardsByWorkspace` returns empty array when no boards
- [ ] 1.5 Update `src/bun/handlers/boards.ts` to use the extracted function (verify no regression)

## 2. Tool definition unit tests

- [ ] 2.1 Create `src/bun/test/workspace-tool-definitions.test.ts`
- [ ] 2.2 Test: `list_projects` exists in `WORKSPACE_TOOL_DEFINITIONS` with no required params
- [ ] 2.3 Test: `list_workflows` exists in `WORKSPACE_TOOL_DEFINITIONS` with no required params
- [ ] 2.4 Test: Both tool names present in `WORKSPACE_TOOL_NAMES`
- [ ] 2.5 Test: Tool descriptions mention workspace context guidance

## 3. Tool registration extension tests

- [ ] 3.1 Append tests to `src/bun/test/common-tools-registration.test.ts`
- [ ] 3.2 Test: Copilot engine registers `list_projects` via `buildCopilotTools()`
- [ ] 3.3 Test: Copilot engine registers `list_workflows` via `buildCopilotTools()`
- [ ] 3.4 Test: Claude engine registers `list_projects` via `buildClaudeToolServer()`
- [ ] 3.5 Test: Claude engine registers `list_workflows` via `buildClaudeToolServer()`

## 4. Tool execution unit tests

- [ ] 4.1 Create `src/bun/test/workspace-tool-execution.test.ts`
- [ ] 4.2 Test: `list_projects` returns full project data when projects configured (setup via `setupTestConfig()`)
- [ ] 4.3 Test: `list_projects` returns `[]` when no projects configured
- [ ] 4.4 Test: `list_projects` uses `workspaceKey` from `CommonToolContext`
- [ ] 4.5 Test: `list_workflows` returns board id+name when boards in DB
- [ ] 4.6 Test: `list_workflows` returns `[]` when no boards in DB
- [ ] 4.7 Test: `list_workflows` uses `workspaceKey` from `CommonToolContext`
- [ ] 4.8 Test: `executeCommonTool` validates no unexpected args for both tools

## 5. Workspace key threading integration tests

- [ ] 5.1 Append tests to `src/bun/test/execution-params-builder.test.ts`
- [ ] 5.2 Test: `buildForChat(workspaceKey="default")` sets `ExecutionParams.workspaceKey`
- [ ] 5.3 Test: `buildForChat()` without workspaceKey leaves it undefined (backward compat)

## 6. End-to-end tool execution with chat session

- [ ] 6.1 Write tests in `workspace-tool-execution.test.ts` that seed a chat session via `seedChatSession()`
- [ ] 6.2 Test: Tool execution works in chat session context (workspaceKey from session)
- [ ] 6.3 Test: Tool execution works in task context (workspaceKey from board)
