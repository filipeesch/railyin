## 1. Board query extraction tests

- [x] 1.1 Create `src/bun/db/board-queries.ts` with `listBoardsByWorkspace(db, workspaceKey)` function (extracted from boards handler)
- [x] 1.2 Write tests: `listBoardsByWorkspace` returns correct boards ordered by creation time
- [x] 1.3 Write tests: `listBoardsByWorkspace` filters by workspace key
- [x] 1.4 Write tests: `listBoardsByWorkspace` returns empty array when no boards
- [x] 1.5 Update `src/bun/handlers/boards.ts` to use the extracted function (verify no regression)

## 2. Tool definition unit tests

- [x] 2.1 Create `src/bun/test/workspace-tool-definitions.test.ts`
- [x] 2.2 Test: `list_projects` exists in `WORKSPACE_TOOL_DEFINITIONS` with no required params
- [x] 2.3 Test: `list_workflows` exists in `WORKSPACE_TOOL_DEFINITIONS` with no required params
- [x] 2.4 Test: Both tool names present in `WORKSPACE_TOOL_NAMES`
- [x] 2.5 Test: Tool descriptions mention workspace context guidance

## 3. Tool registration extension tests

- [x] 3.1 Append tests to `src/bun/test/common-tools-registration.test.ts`
- [x] 3.2 Test: Copilot engine registers `list_projects` via `buildCopilotTools()`
- [x] 3.3 Test: Copilot engine registers `list_workflows` via `buildCopilotTools()`
- [x] 3.4 Test: Claude engine registers `list_projects` via `buildClaudeToolServer()`
- [x] 3.5 Test: Claude engine registers `list_workflows` via `buildClaudeToolServer()`

## 4. Tool execution unit tests

- [x] 4.1 Create `src/bun/test/workspace-tool-execution.test.ts`
- [x] 4.2 Test: `list_projects` returns full project data when projects configured (setup via `setupTestConfig()`)
- [x] 4.3 Test: `list_projects` returns `[]` when no projects configured
- [x] 4.4 Test: `list_projects` uses `workspaceKey` from `CommonToolContext`
- [x] 4.5 Test: `list_workflows` returns board id+name when boards in DB
- [x] 4.6 Test: `list_workflows` returns `[]` when no boards in DB
- [x] 4.7 Test: `list_workflows` uses `workspaceKey` from `CommonToolContext`
- [x] 4.8 Test: `executeCommonTool` validates no unexpected args for both tools

## 5. Workspace key threading integration tests

- [x] 5.1 Append tests to `src/bun/test/execution-params-builder.test.ts`
- [x] 5.2 Test: `buildForChat(workspaceKey="default")` sets `ExecutionParams.workspaceKey`
- [x] 5.3 Test: `buildForChat()` without workspaceKey leaves it undefined (backward compat)

## 6. End-to-end tool execution with chat session

- [x] 6.1 Write tests in `workspace-tool-execution.test.ts` that seed a chat session via `seedChatSession()`
- [x] 6.2 Test: Tool execution works in chat session context (workspaceKey from session)
- [x] 6.3 Test: Tool execution works in task context (workspaceKey from board)
