## ADDED Requirements

### Requirement: Auto-inject MCP tools into native engine
The `resolveToolsForColumn` function SHALL append MCP tool definitions from the registry after built-in tools. MCP tool names SHALL be namespaced as `mcp__<server>__<tool>`.

#### Scenario: MCP tools appended to built-ins
- **WHEN** `resolveToolsForColumn` is called and the registry has running servers with tools
- **THEN** the returned tool list includes both built-in tools and `mcp__<server>__<tool>` entries

#### Scenario: No MCP registry configured
- **WHEN** no `mcp.json` exists or the registry has no running servers
- **THEN** `resolveToolsForColumn` returns only built-in tools (no change to existing behavior)

### Requirement: Native engine MCP tool dispatch
The `executeTool` function SHALL forward unknown tool names matching the `mcp__<server>__<tool>` pattern to `McpClientRegistry.callTool()`.

#### Scenario: MCP tool call dispatched
- **WHEN** the model calls a tool named `mcp__filesystem__read_file`
- **THEN** `executeTool` extracts server `filesystem` and tool `read_file`, calls the registry, and returns the result string

#### Scenario: Unknown tool not matching MCP pattern
- **WHEN** the model calls a tool name that is neither a built-in nor a valid `mcp__<server>__<tool>` name
- **THEN** `executeTool` returns an error string (existing behavior unchanged)

### Requirement: Copilot engine MCP tool wrappers
The `buildCopilotTools` function SHALL include MCP tool definitions as SDK `Tool` objects, wrapping calls through the `McpClientRegistry`.

#### Scenario: MCP tools available in Copilot session
- **WHEN** the Copilot engine starts an execution and MCP servers are running
- **THEN** the session's tool list includes `mcp__<server>__<tool>` entries callable by the model

### Requirement: Claude engine native MCP pass-through
The Claude engine SHALL pass configured MCP server definitions directly to the Claude Agent SDK `mcpServers` parameter, filtered by the task's `enabled_mcp_tools` list.

#### Scenario: All MCP tools enabled (default)
- **WHEN** `task.enabled_mcp_tools` is `NULL`
- **THEN** all configured MCP servers are passed to the SDK's `mcpServers`

#### Scenario: Specific tools disabled
- **WHEN** `task.enabled_mcp_tools` contains a subset of servers
- **THEN** only the enabled servers are included in `mcpServers`

### Requirement: Per-task tool override
Tasks SHALL store an `enabled_mcp_tools` value (JSON array of `"serverName:toolName"` pairs, or `NULL` for all enabled). This value persists across executions within the same task.

#### Scenario: Tool override persists across executions
- **WHEN** a user disables an MCP tool for a task and a new execution starts
- **THEN** the disabled tool is excluded from the tool list for that execution

#### Scenario: Column transition with explicit tools resets override
- **WHEN** a task transitions to a column with explicitly defined `tools` config
- **THEN** `enabled_mcp_tools` is reset to `NULL` (all MCP tools enabled)

#### Scenario: Column transition without explicit tools preserves override
- **WHEN** a task transitions to a column without an explicit `tools` config
- **THEN** `enabled_mcp_tools` is preserved from the previous state
