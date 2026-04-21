## ADDED Requirements

### Requirement: Typing `@` in the chat editor triggers an agent and tool picker
The system SHALL open an autocomplete dropdown when the user types `@` in the chat editor. In this change, the picker lists MCP tools from all active MCP servers. Sub-agent routing (e.g. `@claude`, `@copilot`) is out of scope and will be added in a future change.

#### Scenario: MCP tools listed grouped by server
- **WHEN** the user types `@` and at least one MCP server is connected
- **THEN** the dropdown shows MCP tools grouped by server name, with tool name and description

#### Scenario: Filtering by tool name
- **WHEN** the user types `@read`
- **THEN** the dropdown narrows to tools whose names fuzzy-match `read`

#### Scenario: Selecting a tool inserts a chip
- **WHEN** the user selects an MCP tool from the picker
- **THEN** the `@query` text is replaced by an atomic chip in the format `@server:toolName`

#### Scenario: No MCP servers connected
- **WHEN** no MCP servers are configured or all are disconnected
- **THEN** the dropdown shows an empty state (e.g. "No tools available") rather than staying open with nothing

#### Scenario: `@` chip at send time passes tool name as text
- **WHEN** the user sends a message containing an `@` tool chip
- **THEN** the chip is serialised as plain text in the prompt (e.g. `@server:toolName`); the engine handles MCP invocation as it does today
