## Purpose
Defines how MCP tools are injected into native engine execution params, scoped by the task's enabled_mcp_tools selection and resolved from the appropriate registry (global or per-project).
## Requirements
### Requirement: Auto-inject MCP tools into native engine
The `resolveToolsForColumn` function SHALL append MCP tool definitions from the registry after built-in tools. MCP tool names SHALL be namespaced as `mcp__<server>__<tool>`.

#### Scenario: MCP tools appended to built-ins
- **WHEN** `resolveToolsForColumn` is called and the registry has running servers with tools
- **THEN** the returned tool list includes both built-in tools and `mcp__<server>__<tool>` entries

#### Scenario: No MCP registry configured
- **WHEN** no `mcp.json` exists or the registry has no running servers
- **THEN** `resolveToolsForColumn` returns only built-in tools (no change to existing behavior)

### Requirement: Native engine MCP tool dispatch
The `executeTool` function SHALL forward unknown tool names matching the `mcp__<server>__<tool>` pattern to the injected `McpClientRegistry.callTool()`. The registry is received via `ExecutionParams`, not fetched from a module-level global.

#### Scenario: MCP tool call dispatched
- **WHEN** the model calls a tool named `mcp__filesystem__read_file`
- **THEN** `executeTool` extracts server `filesystem` and tool `read_file`, calls the injected registry, and returns the result string

#### Scenario: Unknown tool not matching MCP pattern
- **WHEN** the model calls a tool name that is neither a built-in nor a valid `mcp__<server>__<tool>` name
- **THEN** `executeTool` returns an error string (existing behavior unchanged)

### Requirement: Copilot engine MCP tool wrappers
The `buildCopilotTools` function SHALL include MCP tool definitions as SDK `Tool` objects, wrapping calls through the `McpClientRegistry`.

#### Scenario: MCP tools available in Copilot session
- **WHEN** the Copilot engine starts an execution and MCP servers are running
- **THEN** the session's tool list includes `mcp__<server>__<tool>` entries callable by the model

### Requirement: Claude engine native MCP pass-through
The Claude engine SHALL pass configured MCP server definitions directly to the Claude Agent SDK `mcpServers` parameter, filtered by the task's `enabled_mcp_tools` list. The registry is sourced from `ExecutionParams.mcpRegistry`.

#### Scenario: No MCP tools enabled (default)
- **WHEN** `task.enabled_mcp_tools` is `[]`
- **THEN** no MCP servers are passed to the SDK's `mcpServers` (empty list)

#### Scenario: Specific tools enabled
- **WHEN** `task.enabled_mcp_tools` contains a non-empty subset of server:tool pairs
- **THEN** only the matching servers are included in `mcpServers`

### Requirement: Per-task tool override
Tasks SHALL store an `enabled_mcp_tools` value (JSON array of `"serverName:toolName"` pairs, or `[]` for none enabled). New tasks SHALL default to `[]` (all MCP tools disabled). The value persists across executions within the same task.

#### Scenario: New task defaults to no MCP tools
- **WHEN** a new task is created
- **THEN** `enabled_mcp_tools` is set to `[]` and no MCP tools are active for that task

#### Scenario: Tool override persists across executions
- **WHEN** a user enables an MCP tool for a task and a new execution starts
- **THEN** the enabled tool is included in the tool list for that execution

#### Scenario: Column transition with explicit tools resets override
- **WHEN** a task transitions to a column with explicitly defined `tools` config
- **THEN** `enabled_mcp_tools` is reset to `[]` (all MCP tools disabled)

#### Scenario: Column transition without explicit tools preserves override
- **WHEN** a task transitions to a column without an explicit `tools` config
- **THEN** `enabled_mcp_tools` is preserved from the previous state

### Requirement: DB migration resets NULL to empty array
A DB migration SHALL convert all `NULL` values in `tasks.enabled_mcp_tools` and `chat_sessions.enabled_mcp_tools` to `'[]'`. After migration, `NULL` in code is treated identically to `[]` (no special-casing).

#### Scenario: Existing tasks after migration
- **WHEN** the migration runs on a database with existing tasks that have `enabled_mcp_tools = NULL`
- **THEN** those rows are updated to `enabled_mcp_tools = '[]'`

#### Scenario: Existing sessions after migration
- **WHEN** the migration runs on a database with existing sessions that have `enabled_mcp_tools = NULL`
- **THEN** those rows are updated to `enabled_mcp_tools = '[]'`

