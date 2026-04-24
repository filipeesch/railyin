## Purpose
Defines file editor overlays and MCP tool controls across task and standalone session chat surfaces.

## Requirements

### Requirement: Generic file editor overlay
The system SHALL provide a `FileEditorOverlay` Vue component that renders a full-screen Monaco editor overlay for editing arbitrary text files, supporting JSON, YAML, and TypeScript syntax highlighting.

#### Scenario: JSON editing with validation
- **WHEN** `FileEditorOverlay` is opened with `language="json"`
- **THEN** Monaco provides JSON syntax highlighting and the footer shows a live parse error or "Valid JSON ✓"

#### Scenario: Save triggers callback
- **WHEN** the user clicks "Save" and the content is valid
- **THEN** the `onSave` prop function is called with the edited content string

#### Scenario: Dark mode
- **WHEN** the application is in dark mode
- **THEN** Monaco uses the `vs-dark` theme

### Requirement: WorkflowEditorOverlay refactored
`WorkflowEditorOverlay.vue` SHALL be refactored to use `FileEditorOverlay` internally. Its external API (props and events) SHALL remain unchanged.

#### Scenario: Workflow editor unchanged externally
- **WHEN** `WorkflowEditorOverlay` is used with its existing props
- **THEN** behavior is identical to before the refactor

### Requirement: MCP tools icon button in chat drawer
The chat drawer SHALL display an icon-only button (no label) in the model-row toolbar that opens the `McpToolsPopover`. The button SHALL show an active indicator when MCP servers are configured, and a warning indicator when at least one configured server is in `error` state.

#### Scenario: No MCP configured
- **WHEN** no `mcp.json` exists
- **THEN** the tools button is not shown (or shown without any status indicator)

#### Scenario: All servers running
- **WHEN** all configured MCP servers are in `running` state
- **THEN** the button shows an active indicator (green dot)

#### Scenario: At least one server offline
- **WHEN** at least one configured MCP server is in `error` state
- **THEN** the button shows a warning indicator (exclamation mark)

### Requirement: MCP tools popover
The `McpToolsPopover` SHALL display a balloon overlay with a tree of MCP servers and their tools as checkboxes, a per-server reload button, and actions to reload config and open the config editor.

#### Scenario: Server tree with status
- **WHEN** the popover is opened
- **THEN** each configured server appears with a status indicator (running = green, error = red) and its tools listed as checkboxes

#### Scenario: Disable a tool for current task
- **WHEN** a user unchecks a tool in the popover
- **THEN** the tool is added to `enabled_mcp_tools` exclusion list for the current task via `mcp.setTaskTools` RPC

#### Scenario: Reload individual server
- **WHEN** the user clicks the reload button next to a server
- **THEN** `mcp.reload` is called for that server and the status updates

#### Scenario: Edit mcp.json
- **WHEN** the user clicks "Edit mcp.json"
- **THEN** `FileEditorOverlay` opens with the current `mcp.json` content; saving triggers `mcp.saveConfig` and an immediate registry reload

### Requirement: MCP tools controls work in standalone sessions
The chat drawer SHALL expose the MCP tools button and popover in standalone session chat as well as task chat.

#### Scenario: Session drawer shows MCP tools button
- **WHEN** a standalone chat session is open and MCP tools are available for the workspace
- **THEN** the shared input toolbar shows the MCP tools button in the same position and style used in task chat

#### Scenario: Session drawer shows MCP tool status
- **WHEN** the standalone session input renders the MCP tools button
- **THEN** the button reflects the same active and warning indicators used in task chat

### Requirement: MCP tool selection is session compatible
The system SHALL allow MCP tool enablement for standalone sessions without requiring a task ID.

#### Scenario: Session tool selection persists without task context
- **WHEN** the user enables or disables an MCP tool from a standalone session
- **THEN** the tool selection is persisted through a session-compatible or conversation-compatible backend path

#### Scenario: Session tool selection affects subsequent turns
- **WHEN** the user changes enabled MCP tools in a standalone session
- **THEN** subsequent session executions run with the updated tool selection
