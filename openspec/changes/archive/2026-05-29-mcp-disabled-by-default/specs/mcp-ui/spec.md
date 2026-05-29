## MODIFIED Requirements

### Requirement: MCP tools popover
The `McpToolsPopover` SHALL display a balloon overlay with a tree of MCP servers and their tools as checkboxes, a per-server reload button, and actions to reload config and open config editors.

#### Scenario: Server tree with status
- **WHEN** the popover is opened
- **THEN** each configured server appears with a status indicator (running = green, error = red) and its tools listed as checkboxes

#### Scenario: All tools unchecked by default for new task
- **WHEN** the popover is opened for a task with `enabled_mcp_tools = []`
- **THEN** all tool checkboxes are unchecked

#### Scenario: Enable a tool for current task
- **WHEN** a user checks a tool in the popover
- **THEN** the tool is added to the `enabled_mcp_tools` list for the current task via `mcp.setTaskTools` RPC

#### Scenario: Reload individual server
- **WHEN** the user clicks the reload button next to a server
- **THEN** `mcp.reload` is called for that server and the status updates

#### Scenario: Edit global mcp.json
- **WHEN** the user clicks "Edit global mcp.json"
- **THEN** `FileEditorOverlay` opens with the current global `~/.railyn/mcp.json` content; saving triggers `mcp.saveConfig` and an immediate registry reload

#### Scenario: Edit project mcp.json (task chat only)
- **WHEN** the user is in task chat (project_key is set) and clicks "Edit project mcp.json"
- **THEN** `FileEditorOverlay` opens with the current `<projectPath>/.railyn/mcp.json` content; saving triggers `mcp.saveProjectConfig` and a project registry reload

#### Scenario: Project edit button hidden in session chat
- **WHEN** the user is in a standalone session (no project_key)
- **THEN** the "Edit project mcp.json" button is not rendered in the popover footer

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
The chat drawer SHALL display an icon-only button (no label) in the model-row toolbar that opens the `McpToolsPopover`. The button SHALL show an active indicator when at least one MCP tool is enabled for the current task/session, and a warning indicator when at least one configured server is in `error` state.

#### Scenario: No MCP configured
- **WHEN** no `mcp.json` exists
- **THEN** the tools button is not shown (or shown without any status indicator)

#### Scenario: All tools disabled (default)
- **WHEN** the task has `enabled_mcp_tools = []`
- **THEN** the button shows no active indicator

#### Scenario: At least one server offline
- **WHEN** at least one configured MCP server is in `error` state
- **THEN** the button shows a warning indicator (exclamation mark)

### Requirement: MCP tools controls work in standalone sessions
The chat drawer SHALL expose the MCP tools button and popover in standalone session chat as well as task chat.

#### Scenario: Session drawer shows MCP tools button
- **WHEN** a standalone chat session is open and MCP tools are available for the workspace
- **THEN** the shared input toolbar shows the MCP tools button

#### Scenario: Session tool selection persists without task context
- **WHEN** the user enables or disables an MCP tool from a standalone session
- **THEN** the tool selection is persisted through the session-compatible backend path (`mcp.setSessionTools`)

#### Scenario: Session tool selection affects subsequent turns
- **WHEN** the user changes enabled MCP tools in a standalone session
- **THEN** subsequent session executions run with the updated tool selection
