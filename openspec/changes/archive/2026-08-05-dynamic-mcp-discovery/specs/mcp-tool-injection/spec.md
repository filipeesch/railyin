## REMOVED Requirements

### Requirement: Auto-inject MCP tools into native engine
**Reason**: The "native engine" tool-resolution path (`resolveToolsForColumn` appending MCP tool definitions) is no longer how any current engine sources MCP tools — this requirement predates the multi-engine architecture (Copilot/Cursor/Claude/Pi/OpenCode) and is not implemented by current code (`resolveToolsForColumn` in `workflow/tools/registry.ts` has no MCP-related logic today). Superseded by the `mcp-tool-discovery` capability's `list_mcp_servers`/`list_mcp_tools`/`invoke_mcp_tool` common tools, available identically across all engines.
**Migration**: No migration needed — no current code path exercises this requirement. Any lingering references to `resolveToolsForColumn` + MCP should be treated as documentation of removed/never-completed behavior.

### Requirement: Native engine MCP tool dispatch
**Reason**: Same as above — there is no "native engine" `executeTool` MCP dispatch fallthrough in current code. Superseded by `invoke_mcp_tool` in the `mcp-tool-discovery` capability.
**Migration**: None needed; no current code implements this dispatch.

### Requirement: Copilot engine MCP tool wrappers
**Reason**: Wrapping every enabled MCP tool as its own Copilot SDK `Tool` object (`buildCopilotTools`'s `mcpRegistry.listTools().map(...)`) is exactly the native-injection "noise" this change eliminates. Superseded by the 3 common discovery tools, which Copilot now receives through the same `COMMON_TOOL_DEFINITIONS` mechanism as its other common tools.
**Migration**: Remove the `mcpRegistry`/`enabledMcpTools` parameters and the `mcpTools` mapping block from `buildCopilotTools` in `engine/copilot/tools.ts`. No data migration — this is a code-only removal.

### Requirement: Claude engine native MCP pass-through
**Reason**: Passing configured MCP server definitions directly to the Claude Agent SDK's `mcpServers` parameter is replaced by routing Claude through the same common-tools discovery mechanism as every other engine, using `McpClientRegistry` for actual invocation instead of the SDK's own MCP connection management.
**Migration**: Remove `buildExternalMcpServers`/`buildAllowedExternalMcpTools` from `engine/claude/adapter.ts`; remove `externalMcpServers`/`enabledMcpTools` fields from `ClaudeRunConfig`; remove the `mcpRegistry`/`externalMcpServers` computation in `engine/claude/engine.ts`. No data migration — code-only removal.

## MODIFIED Requirements

### Requirement: Per-task tool override
Tasks SHALL store an `enabled_mcp_tools` value (JSON array of `"serverName:toolName"` pairs, or `[]` for none visible). New tasks SHALL default to `[]` (no MCP tools visible to the model). The value persists across executions within the same task. Unlike prior behavior, this value no longer gates native tool injection (there is none) — it instead filters which tools the `list_mcp_tools` and `invoke_mcp_tool` common tools (from the `mcp-tool-discovery` capability) reveal and allow for that task. `list_mcp_servers` is unaffected by this filter — server-level visibility is independent of per-tool visibility.

#### Scenario: New task defaults to no MCP tools visible
- **WHEN** a new task is created
- **THEN** `enabled_mcp_tools` is set to `[]` and `list_mcp_tools` returns no tools for any server for that task until the user enables specific tools

#### Scenario: Tool override persists across executions
- **WHEN** a user enables an MCP tool for a task and a new execution starts
- **THEN** `list_mcp_tools` and `invoke_mcp_tool` treat that tool as visible/allowed for that execution

#### Scenario: Column transition with explicit tools resets override
- **WHEN** a task transitions to a column with explicitly defined `tools` config
- **THEN** `enabled_mcp_tools` is reset to `[]` (no MCP tools visible)

#### Scenario: Column transition without explicit tools preserves override
- **WHEN** a task transitions to a column without an explicit `tools` config
- **THEN** `enabled_mcp_tools` is preserved from the previous state

#### Scenario: Enabled tool is visible in list_mcp_tools
- **WHEN** `"filesystem:read_file"` is present in a task's `enabled_mcp_tools`
- **THEN** `list_mcp_tools("filesystem")` for that task includes `read_file`

#### Scenario: Disabled tool is rejected by invoke_mcp_tool
- **WHEN** a task's `enabled_mcp_tools` does not contain `"filesystem:read_file"`
- **THEN** `invoke_mcp_tool("filesystem", "read_file", args)` for that task returns an error instead of invoking the tool
