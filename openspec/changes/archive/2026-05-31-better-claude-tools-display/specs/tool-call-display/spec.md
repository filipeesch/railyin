## MODIFIED Requirements

### Requirement: Unknown tool names produce a humanized display
The system SHALL produce a humanized fallback label for tool names not in any known tool set by:
1. Stripping a leading `mcp__` prefix if present
2. Replacing double-underscore `__` with a space (MCP server/tool separator)
3. Replacing remaining single underscores `_` with spaces

#### Scenario: Unknown plain tool name is humanized
- **WHEN** an engine emits `tool_start` for a tool name `some_custom_tool` not in any known tool set
- **THEN** the emitted event carries `display: { label: "some custom tool" }` with no subject or contentType

#### Scenario: External MCP tool name is humanized
- **WHEN** the Claude engine emits `tool_start` for `mcp__other-server__do_thing`
- **THEN** the emitted event carries `display: { label: "other-server do thing" }` with no subject or contentType

## ADDED Requirements

### Requirement: Claude engine normalizes railyin MCP-prefixed tool names before display routing
The Claude engine SHALL strip the `mcp__railyin__` prefix from a tool name before routing it through the display builder, so that railyin common tools always receive the same clean label regardless of how the SDK delivers them.

#### Scenario: Railyin common tool called from Claude renders with clean label
- **WHEN** the Claude engine emits `tool_start` for `mcp__railyin__decision_request`
- **THEN** the emitted event carries `display: { label: "decision request" }` (same as if the tool were called without prefix)

#### Scenario: Railyin move_task called from Claude renders with subject
- **WHEN** the Claude engine emits `tool_start` for `mcp__railyin__move_task` with `task_id: 5` and `workflow_state: "done"`
- **THEN** the emitted event carries `display: { label: "move task", subject: "#5 → done" }`

### Requirement: Claude engine treats MCP-prefixed railyin internal tools as internal
The Claude engine SHALL recognize `mcp__railyin__report_intent` and any other MCP-prefixed tool whose bare name is an internal tool name as internal, suppressing it from the UI.

#### Scenario: report_intent called via MCP prefix is suppressed
- **WHEN** the Claude engine receives `tool_use` for `mcp__railyin__report_intent`
- **THEN** `isInternalClaudeToolName` returns `true` and no `tool_start` event is emitted to the UI

### Requirement: OpenCode engine attaches display to tool_start events
The OpenCode engine SHALL compute and attach a `display` field when emitting `tool_start` events, using `buildCommonToolDisplay` for known railyin tools and `humanizeToolName` as fallback.

#### Scenario: OpenCode common tool emits display
- **WHEN** the OpenCode engine processes a tool part with `tool: "move_task"` and `status: "running"`
- **THEN** the emitted `tool_start` event carries a populated `display` field with `{ label: "move task", subject: ... }`

#### Scenario: OpenCode unknown tool emits humanized label
- **WHEN** the OpenCode engine processes a tool part for an unrecognized tool name
- **THEN** the emitted `tool_start` event carries `display: { label: <humanized name> }`
