## ADDED Requirements

### Requirement: Tool definitions are correct and consistent
The system SHALL have tests that verify `list_projects` and `list_workflows` are properly defined in `WORKSPACE_TOOL_DEFINITIONS` with correct JSON schemas, required parameters, and names in `WORKSPACE_TOOL_NAMES`.

#### Scenario: list_projects definition exists with no required parameters
- **WHEN** tests inspect `WORKSPACE_TOOL_DEFINITIONS`
- **THEN** a tool named `list_projects` exists with `parameters.properties` containing no `required` fields

#### Scenario: list_workflows definition exists with no required parameters
- **WHEN** tests inspect `WORKSPACE_TOOL_DEFINITIONS`
- **THEN** a tool named `list_workflows` exists with `parameters.properties` containing no `required` fields

#### Scenario: Both tool names are in WORKSPACE_TOOL_NAMES
- **WHEN** tests check `WORKSPACE_TOOL_NAMES.has()`
- **THEN** both `"list_projects"` and `"list_workflows"` return `true`

#### Scenario: Tool descriptions include workspace context guidance
- **WHEN** tests inspect tool descriptions
- **THEN** each description mentions that the workspace is determined from execution context

### Requirement: Tools register in all engine paths
The system SHALL have tests that verify `list_projects` and `list_workflows` are registered through both Copilot and Claude engine tool registration paths.

#### Scenario: Copilot engine registers list_projects
- **WHEN** `buildCopilotTools(baseContext)` is called
- **THEN** the returned tools array includes a tool named `list_projects`

#### Scenario: Copilot engine registers list_workflows
- **WHEN** `buildCopilotTools(baseContext)` is called
- **THEN** the returned tools array includes a tool named `list_workflows`

#### Scenario: Claude engine registers list_projects
- **WHEN** `buildClaudeToolServer(sdk, z, baseContext)` is called
- **THEN** the registered tool names include `list_projects`

#### Scenario: Claude engine registers list_workflows
- **WHEN** `buildClaudeToolServer(sdk, z, baseContext)` is called
- **THEN** the registered tool names include `list_workflows`

### Requirement: list_projects returns full project data
The system SHALL have tests that verify `list_projects` tool execution returns complete project data when projects are configured.

#### Scenario: Returns full project data for configured projects
- **WHEN** `executeCommonTool("list_projects", {}, context)` is called with a workspace containing projects
- **THEN** the result contains JSON with `key`, `name`, `workspaceKey`, `projectPath.{absolute,relative}`, `gitRootPath.{absolute,relative}`, `defaultBranch` for each project

#### Scenario: Returns empty array when no projects configured
- **WHEN** `executeCommonTool("list_projects", {}, context)` is called with a workspace containing no projects
- **THEN** the result is `"[]"`

#### Scenario: Uses workspaceKey from CommonToolContext
- **WHEN** `executeCommonTool("list_projects", {}, context)` is called with `context.workspaceKey = "other-ws"`
- **THEN** only projects from the `"other-ws"` workspace are returned

### Requirement: list_workflows returns board data
The system SHALL have tests that verify `list_workflows` tool execution returns board data from the database.

#### Scenario: Returns board id and name for configured boards
- **WHEN** `executeCommonTool("list_workflows", {}, context)` is called with a workspace containing boards
- **THEN** the result contains JSON with `id`, `name`, `workspaceKey` for each board

#### Scenario: Returns empty array when no boards exist
- **WHEN** `executeCommonTool("list_workflows", {}, context)` is called with a workspace containing no boards
- **THEN** the result is `"[]"`

#### Scenario: Uses workspaceKey from CommonToolContext
- **WHEN** `executeCommonTool("list_workflows", {}, context)` is called with `context.workspaceKey = "other-ws"`
- **THEN** only boards from the `"other-ws"` workspace are returned

### Requirement: Board query extraction is testable
The system SHALL have tests that verify the extracted `listBoardsByWorkspace` function works independently of the `boards.list` RPC handler.

#### Scenario: listBoardsByWorkspace returns correct boards
- **WHEN** `listBoardsByWorkspace(db, "default")` is called with boards in the DB
- **THEN** the result matches the boards in the database ordered by creation time

#### Scenario: listBoardsByWorkspace filters by workspace key
- **WHEN** `listBoardsByWorkspace(db, "other-ws")` is called with boards in multiple workspaces
- **THEN** only boards with `workspace_key = "other-ws"` are returned

#### Scenario: boards.list RPC still works after refactoring
- **WHEN** `boards.list` RPC is called after extraction
- **THEN** the response includes board data plus enriched template information (no regression)

### Requirement: Workspace key threads through chat execution
The system SHALL have tests that verify `workspaceKey` is correctly passed from chat session context through `ExecutionParamsBuilder.buildForChat()` to `ExecutionParams`.

#### Scenario: buildForChat sets workspaceKey on ExecutionParams
- **WHEN** `paramsBuilder.buildForChat(..., workspaceKey="default")` is called
- **THEN** the returned `ExecutionParams` has `workspaceKey === "default"`

#### Scenario: ChatExecutor passes workspaceKey to buildForChat
- **WHEN** `chatExecutor.execute(sessionId, conversationId, content, model, mcpTools, "default", attachments)` is called
- **THEN** `buildForChat()` receives `"default"` as the `workspaceKey` parameter
