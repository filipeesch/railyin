## 1. Refactor board query extraction

- [ ] 1.1 Extract `listBoardsByWorkspace(db, workspaceKey)` from `src/bun/handlers/boards.ts` into a standalone function in `src/bun/db/board-queries.ts` (or similar location)
- [ ] 1.2 Update `boards.list` RPC handler to use the extracted function

## 2. Tool definitions

- [ ] 2.1 Create `src/bun/engine/workspace-tool-definitions.ts` with `list_projects` and `list_workflows` tool definitions (metadata + JSON schemas), export `WORKSPACE_TOOL_DEFINITIONS` and `WORKSPACE_TOOL_NAMES`

## 3. Thread workspaceKey through chat execution

- [ ] 3.1 Add `workspaceKey` parameter to `ExecutionParamsBuilder.buildForChat()` in `src/bun/engine/execution/execution-params-builder.ts`
- [ ] 3.2 Pass `workspaceKey` from `ChatExecutor.execute()` to `buildForChat()` in `src/bun/engine/execution/chat-executor.ts`

## 4. Register tools in common-tools

- [ ] 4.1 Import `WORKSPACE_TOOL_DEFINITIONS` and `WORKSPACE_TOOL_NAMES` in `src/bun/engine/common-tools.ts`
- [ ] 4.2 Append definitions to `COMMON_TOOL_DEFINITIONS` array
- [ ] 4.3 Add tool names to `COMMON_TOOL_NAMES` set
- [ ] 4.4 Add `list_projects` and `list_workflows` cases to `executeCommonToolText()` switch
- [ ] 4.5 Add display labels to `buildCommonToolDisplay()` switch

## 5. Implement tool execution logic

- [ ] 5.1 `list_projects`: call `listProjectsForWorkspace(workspaceKey)` from `project-store.ts`, map results to JSON string
- [ ] 5.2 `list_workflows`: call `listBoardsByWorkspace(db, workspaceKey)`, map to JSON string
- [ ] 5.3 Handle empty results gracefully (return `[]` not error)

## 6. Wire up CommonToolContext

- [ ] 6.1 Ensure `CommonToolContext.workspaceKey` is populated for chat sessions (verify `ExecutionParams.workspaceKey` flows through to tool context)

- [ ] 1.1 Create `src/bun/engine/workspace-tool-definitions.ts` with `list_projects` and `list_workflows` tool definitions (metadata + JSON schemas), export `WORKSPACE_TOOL_DEFINITIONS` and `WORKSPACE_TOOL_NAMES`

## 2. Thread workspaceKey through chat execution

- [ ] 2.1 Add `workspaceKey` parameter to `ExecutionParamsBuilder.buildForChat()` in `src/bun/engine/execution/execution-params-builder.ts`
- [ ] 2.2 Pass `workspaceKey` from `ChatExecutor.execute()` to `buildForChat()` in `src/bun/engine/execution/chat-executor.ts`

## 3. Register tools in common-tools

- [ ] 3.1 Import `WORKSPACE_TOOL_DEFINITIONS` and `WORKSPACE_TOOL_NAMES` in `src/bun/engine/common-tools.ts`
- [ ] 3.2 Append definitions to `COMMON_TOOL_DEFINITIONS` array
- [ ] 3.3 Add tool names to `COMMON_TOOL_NAMES` set
- [ ] 3.4 Add `list_projects` and `list_workflows` cases to `executeCommonToolText()` switch
- [ ] 3.5 Add display labels to `buildCommonToolDisplay()` switch

## 4. Implement tool execution logic

- [ ] 4.1 `list_projects`: call `listProjectsForWorkspace(workspaceKey)` from `project-store.ts`, map results to JSON string
- [ ] 4.2 `list_workflows`: query `boards` table (`SELECT id, name, workspace_key FROM boards WHERE workspace_key = ?`), map to JSON string
- [ ] 4.3 Handle empty results gracefully (return `[]` not error)

## 5. Wire up CommonToolContext

- [ ] 5.1 Ensure `CommonToolContext.workspaceKey` is populated for chat sessions (verify `ExecutionParams.workspaceKey` flows through to tool context)
