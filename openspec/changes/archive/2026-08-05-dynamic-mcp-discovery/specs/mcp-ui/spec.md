## MODIFIED Requirements

### Requirement: MCP tools popover
The `McpToolsPopover` SHALL display a balloon overlay with a tree of MCP servers and their tools as checkboxes, a per-server reload button (or "Sign in" button when the server requires authorization), and actions to reload config and open config editors. Checkboxes now control whether a tool is **visible to the model via the `list_mcp_tools`/`invoke_mcp_tool` discovery tools** (the `mcp-tool-discovery` capability), rather than whether the tool is natively injected — the underlying `enabled_mcp_tools` storage and `mcp.setTaskTools`/`mcp.setSessionTools` RPCs are unchanged.

#### Scenario: Server tree with status
- **WHEN** the popover is opened
- **THEN** each configured server appears with a status indicator (running = green, error = red, auth_required = amber/lock icon) and its tools listed as checkboxes

#### Scenario: All tools unchecked by default for new task
- **WHEN** the popover is opened for a task with `enabled_mcp_tools = []`
- **THEN** all tool checkboxes are unchecked, and `list_mcp_tools` returns no tools for that task until the user checks some

#### Scenario: Enable a tool for current task
- **WHEN** a user checks a tool in the popover
- **THEN** the tool is added to the `enabled_mcp_tools` list for the current task via `mcp.setTaskTools` RPC, making it visible to `list_mcp_tools` and callable via `invoke_mcp_tool` for that task

#### Scenario: Reload individual server
- **WHEN** the user clicks the reload button next to a server not in `auth_required` state
- **THEN** `mcp.reload` is called for that server and the status updates

#### Scenario: Sign in to a server requiring authorization
- **WHEN** a server is in `auth_required` state
- **THEN** the popover shows a "Sign in" button in place of the reload button for that server, and clicking it calls `mcp.authorize(serverName)`

#### Scenario: Edit global mcp.json
- **WHEN** the user clicks "Edit global mcp.json"
- **THEN** `FileEditorOverlay` opens with the current global `~/.railyn/mcp.json` content; saving triggers `mcp.saveConfig` and an immediate registry reload

#### Scenario: Edit project mcp.json (task chat only)
- **WHEN** the user is in task chat (project_key is set) and clicks "Edit project mcp.json"
- **THEN** `FileEditorOverlay` opens with the current `<projectPath>/.railyn/mcp.json` content; saving triggers `mcp.saveProjectConfig` and a project registry reload

#### Scenario: Project edit button hidden in session chat
- **WHEN** the user is in a standalone session (no project_key)
- **THEN** the "Edit project mcp.json" button is not rendered in the popover footer
