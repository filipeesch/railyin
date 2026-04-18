## MODIFIED Requirements

### Requirement: resolveToolsForColumn includes MCP tools
The `resolveToolsForColumn` function SHALL accept an optional `McpClientRegistry` parameter and append namespaced MCP tool definitions (`mcp__<server>__<tool>`) after built-in tools when the registry is provided and has running servers.

#### Scenario: Built-ins only (no registry)
- **WHEN** `resolveToolsForColumn` is called without a registry
- **THEN** returns only built-in tool definitions (existing behavior preserved)

#### Scenario: Built-ins plus MCP tools
- **WHEN** `resolveToolsForColumn` is called with a registry that has running servers
- **THEN** returns built-in tools followed by MCP tool definitions in `mcp__<server>__<tool>` format

### Requirement: executeTool dispatches MCP tool calls
The `executeTool` function SHALL handle tool names matching `mcp__<server>__<tool>` by delegating to `McpClientRegistry.callTool(server, tool, args)`. All other tool names retain existing behavior.

#### Scenario: MCP dispatch
- **WHEN** `executeTool` is called with a name matching the `mcp__` prefix pattern
- **THEN** the call is delegated to the registry and the result string is returned

#### Scenario: Non-MCP dispatch unchanged
- **WHEN** `executeTool` is called with a built-in tool name
- **THEN** the existing switch case handles it (no change)
