## Purpose
Defines the per-task/session `enabled_mcp_tools` visibility override, which filters which MCP tools are visible via and callable through the `mcp-tool-discovery` capability's `list_mcp_tools`/`invoke_mcp_tool` common tools, resolved from the appropriate registry (global or per-project).
## Requirements
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

### Requirement: DB migration resets NULL to empty array
A DB migration SHALL convert all `NULL` values in `tasks.enabled_mcp_tools` and `chat_sessions.enabled_mcp_tools` to `'[]'`. After migration, `NULL` in code is treated identically to `[]` (no special-casing).

#### Scenario: Existing tasks after migration
- **WHEN** the migration runs on a database with existing tasks that have `enabled_mcp_tools = NULL`
- **THEN** those rows are updated to `enabled_mcp_tools = '[]'`

#### Scenario: Existing sessions after migration
- **WHEN** the migration runs on a database with existing sessions that have `enabled_mcp_tools = NULL`
- **THEN** those rows are updated to `enabled_mcp_tools = '[]'`

