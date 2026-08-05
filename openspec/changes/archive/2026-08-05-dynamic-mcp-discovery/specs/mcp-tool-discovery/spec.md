## ADDED Requirements

### Requirement: list_mcp_servers common tool
The system SHALL expose a common tool `list_mcp_servers` (no arguments) available identically across all engines (Copilot, Cursor, Claude, Pi, OpenCode) via `COMMON_TOOL_DEFINITIONS`/`executeCommonTool`. It SHALL return every MCP server configured in the resolved scope's `mcp.json` (project-level if applicable, else global), regardless of the per-task/session `enabled_mcp_tools` visibility filter, including: server name, `description` (if configured), lifecycle `state` (`running`/`starting`/`idle`/`error`/`auth_required`/`disabled`), and `error` message when in `error` state.

#### Scenario: Lists all configured servers regardless of task visibility filter
- **WHEN** `list_mcp_servers` is called for a task with `enabled_mcp_tools = []`
- **THEN** the result still includes every server configured in `mcp.json`, not filtered by the empty visibility array

#### Scenario: Includes non-running servers with state and error
- **WHEN** `list_mcp_servers` is called and a configured server is in `error` or `auth_required` state
- **THEN** that server is included in the result with its `state` and, if present, its `error` message

#### Scenario: Excludes servers disabled via config
- **WHEN** a server has `"enabled": false` in `mcp.json`
- **THEN** `list_mcp_servers` still lists it with `state: "disabled"` (matching existing registry behavior), not omitted entirely

#### Scenario: No servers configured
- **WHEN** no `mcp.json` exists for the resolved scope
- **THEN** `list_mcp_servers` returns an empty list, not an error

### Requirement: list_mcp_tools common tool
The system SHALL expose a common tool `list_mcp_tools(server: string)` that returns all tools available on the given server: each tool's unqualified `name`, `description`, and argument schema (including per-argument descriptions from the tool's `inputSchema`). The result SHALL be filtered by the calling task/session's `enabled_mcp_tools` visibility list: only tools whose `"<server>:<tool>"` pair is present in that list are returned.

#### Scenario: Lists tools for a running server with tools enabled
- **WHEN** `list_mcp_tools("filesystem")` is called and `enabled_mcp_tools` contains `"filesystem:read_file"`
- **THEN** the result includes `read_file` with its description and argument schema, and excludes any other `filesystem` tools not present in `enabled_mcp_tools`

#### Scenario: Empty visibility filter yields no tools
- **WHEN** `list_mcp_tools(server)` is called and the task's `enabled_mcp_tools` is `[]`
- **THEN** the result is an empty list for that server, even if the server is running and has tools

#### Scenario: Server not running
- **WHEN** `list_mcp_tools(server)` is called for a server not in `running` state
- **THEN** the tool returns an error string indicating the server is unavailable, rather than an empty or partial tool list

#### Scenario: Unknown server name
- **WHEN** `list_mcp_tools(server)` is called with a server name not present in the configured scope
- **THEN** the tool returns an error string indicating the server was not found

### Requirement: invoke_mcp_tool common tool
The system SHALL expose a common tool `invoke_mcp_tool(server: string, tool: string, arguments: object)` that invokes the named tool on the named server via the resolved `McpClientRegistry.callTool()` and returns its text result. Before invoking, it SHALL re-check the calling task/session's `enabled_mcp_tools` visibility list and reject the call if the `"<server>:<tool>"` pair is not present, even if the model somehow supplies a tool name it was not shown by `list_mcp_tools`.

#### Scenario: Successful invocation of an enabled tool
- **WHEN** `invoke_mcp_tool("filesystem", "read_file", { path: "/tmp/x" })` is called and `"filesystem:read_file"` is present in `enabled_mcp_tools`
- **THEN** the registry's `callTool` is invoked with those arguments and its text result is returned

#### Scenario: Rejects invocation of a tool not enabled for this task
- **WHEN** `invoke_mcp_tool(server, tool, args)` is called and `"<server>:<tool>"` is absent from the task's `enabled_mcp_tools`
- **THEN** the tool returns an error string explaining the tool is not enabled for this task, and `McpClientRegistry.callTool` is never called

#### Scenario: Rejects invocation on a non-running server
- **WHEN** `invoke_mcp_tool` is called for a server not in `running` state
- **THEN** the tool returns an error string indicating the server is unavailable, without attempting the call

#### Scenario: Underlying tool call error is surfaced
- **WHEN** the underlying `McpClientRegistry.callTool` call throws or returns an MCP error response
- **THEN** `invoke_mcp_tool` surfaces that error as its text result rather than throwing an unhandled exception

### Requirement: Discovery tools available identically across all engines
The three discovery/invocation tools SHALL be included in `COMMON_TOOL_DEFINITIONS` and dispatched via `executeCommonTool`, making them available to every engine that wires common tools (Copilot, Cursor, Claude, Pi, OpenCode) without any engine-specific MCP tool-listing code.

#### Scenario: Pi engine exposes discovery tools
- **WHEN** the Pi engine builds its tool set for a conversation via `buildAllTools`
- **THEN** `list_mcp_servers`, `list_mcp_tools`, and `invoke_mcp_tool` are present in the tool set (Pi previously had no MCP access at all)

#### Scenario: OpenCode engine exposes discovery tools
- **WHEN** the OpenCode engine's in-process common-tools bridge server is queried by the OpenCode SDK
- **THEN** `list_mcp_servers`, `list_mcp_tools`, and `invoke_mcp_tool` are present among the bridged tools (OpenCode previously had no external MCP access at all)

#### Scenario: Claude engine exposes discovery tools instead of native per-server MCP tools
- **WHEN** the Claude engine starts an execution
- **THEN** the SDK's tool list includes the 3 discovery tools (via the existing `railyin` in-process SDK MCP server) and does NOT include per-tool `mcp__<server>__<tool>` entries from native `mcpServers` pass-through

### Requirement: CommonToolContext carries the resolved MCP registry
`CommonToolContext.runtime` SHALL include an optional `mcpRegistry: McpClientRegistry` field, resolved once per conversation/task by each engine's context-construction code (the project registry if a project path is known, otherwise the global registry from `McpRegistryPool`), following the same resolution pattern already used for `runtime.lspManager`.

#### Scenario: Registry resolved once per conversation
- **WHEN** a `CommonToolContext` is constructed for a conversation with a known project path
- **THEN** `runtime.mcpRegistry` is set to the project-scoped `McpClientRegistry` from `McpRegistryPool.getForProject`, and subsequent tool calls within the same conversation reuse the same instance without re-resolving

#### Scenario: No registry available
- **WHEN** no `mcp.json` exists for the resolved scope and no MCP servers are configured
- **THEN** `runtime.mcpRegistry` may be an empty registry (no servers) rather than `undefined`, so `list_mcp_servers` can still return an empty list without a null-reference error
