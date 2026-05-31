# tool-display-test-coverage

## Purpose

Unit and integration test coverage for tool display utility functions and engine-level tool name translation, ensuring that tool labels are correctly humanized, stripped, and rendered across all engines (Claude, OpenCode, Copilot) and in the Playwright UI.

## Requirements

### Requirement: `stripRailyinMcpPrefix` strips only the railyin MCP namespace
The function accepts a tool name string and returns it with the `mcp__railyin__` prefix removed if present, unchanged otherwise.

#### Scenario: railyin-prefixed name is stripped
- **WHEN** `stripRailyinMcpPrefix("mcp__railyin__decision_request")` is called
- **THEN** returns `"decision_request"`

#### Scenario: railyin-prefixed internal name is stripped
- **WHEN** `stripRailyinMcpPrefix("mcp__railyin__report_intent")` is called
- **THEN** returns `"report_intent"`

#### Scenario: external MCP server name is not stripped
- **WHEN** `stripRailyinMcpPrefix("mcp__other-server__do_thing")` is called
- **THEN** returns `"mcp__other-server__do_thing"` unchanged

#### Scenario: bare tool name is not modified
- **WHEN** `stripRailyinMcpPrefix("bash")` is called
- **THEN** returns `"bash"` unchanged

#### Scenario: empty string is handled safely
- **WHEN** `stripRailyinMcpPrefix("")` is called
- **THEN** returns `""` without throwing

---

### Requirement: `humanizeToolName` produces a readable label from any tool name
The function strips the generic `mcp__` prefix, replaces `__` with a space (server/tool separator), and replaces `_` with a space.

#### Scenario: underscores in a bare tool name become spaces
- **WHEN** `humanizeToolName("some_custom_tool")` is called
- **THEN** returns `"some custom tool"`

#### Scenario: external MCP tool is fully humanized
- **WHEN** `humanizeToolName("mcp__other-server__do_thing")` is called
- **THEN** returns `"other-server do thing"`

#### Scenario: MCP tool with underscored server name is humanized
- **WHEN** `humanizeToolName("mcp__my_server__list_items")` is called
- **THEN** returns `"my server list items"`

#### Scenario: bare tool with no underscores is unchanged
- **WHEN** `humanizeToolName("bash")` is called
- **THEN** returns `"bash"`

#### Scenario: railyin MCP tool falls through correctly (transport-agnostic)
- **WHEN** `humanizeToolName("mcp__railyin__decision_request")` is called
- **THEN** returns `"railyin decision request"` (railyin tools are pre-stripped before humanize is called in practice, but the function itself is transport-agnostic)

---

### Requirement: `stripWorktreePath` removes the absolute worktree path prefix from a subject string

#### Scenario: worktree prefix is stripped from a file path subject
- **WHEN** `stripWorktreePath("/repo/src/foo.ts", "/repo")` is called
- **THEN** returns `"src/foo.ts"`

#### Scenario: trailing slash in worktreePath is handled correctly
- **WHEN** `stripWorktreePath("/repo/src/foo.ts", "/repo/")` is called
- **THEN** returns `"src/foo.ts"`

#### Scenario: subject that does not start with worktreePath is returned as-is
- **WHEN** `stripWorktreePath("/other/path/file.ts", "/repo")` is called
- **THEN** returns `"/other/path/file.ts"`

#### Scenario: empty subject returns undefined
- **WHEN** `stripWorktreePath(undefined, "/repo")` is called
- **THEN** returns `undefined`

#### Scenario: absent worktreePath leaves subject unchanged
- **WHEN** `stripWorktreePath("src/foo.ts", undefined)` is called
- **THEN** returns `"src/foo.ts"`

---

### Requirement: Claude translates `mcp__railyin__` tool calls with clean display labels

#### Scenario: railyin common tool via Claude gets routed to `buildCommonToolDisplay`
- **WHEN** `translateClaudeMessage` receives a `tool_use` block with name `"mcp__railyin__decision_request"`
- **THEN** the emitted `tool_start` event has `display.label = "decision request"`

#### Scenario: railyin tool with subject args produces label + subject
- **WHEN** `translateClaudeMessage` receives `"mcp__railyin__record_decision"` with `{ question: "...", answer: "..." }`
- **THEN** the emitted `tool_start` has a non-empty `display.label = "record decision"`

#### Scenario: `mcp__railyin__report_intent` is marked internal
- **WHEN** `translateClaudeMessage` receives `"mcp__railyin__report_intent"`
- **THEN** the emitted `tool_start` event has `isInternal: true`

#### Scenario: prefixed internal tool is hidden (isInternal)
- **WHEN** `translateClaudeMessage` receives `"mcp__railyin__internal_fallback"`
- **THEN** `isInternal: true`

#### Scenario: railyin common tool is NOT marked internal
- **WHEN** `translateClaudeMessage` receives `"mcp__railyin__decision_request"`
- **THEN** `isInternal: false`

#### Scenario: external MCP tool name is humanized in Claude
- **WHEN** `translateClaudeMessage` receives `"mcp__other-server__do_thing"`
- **THEN** `display.label = "other-server do thing"`

#### Scenario: bare unknown tool name is humanized in Claude
- **WHEN** `translateClaudeMessage` receives `"my_custom_tool"`
- **THEN** `display.label = "my custom tool"`

---

### Requirement: OpenCode `tool_start` events include a `display` field

#### Scenario: known common tool in OpenCode carries correct display
- **WHEN** `translatePart` receives a running `ToolPart` with `tool = "move_task"` and relevant args
- **THEN** the emitted `tool_start` has `display.label = "move task"`

#### Scenario: unknown tool in OpenCode is humanized
- **WHEN** `translatePart` receives a running `ToolPart` with `tool = "my_custom_tool"`
- **THEN** the emitted `tool_start` has `display.label = "my custom tool"`

#### Scenario: existing `bash` running state test includes display assertion
- **WHEN** `translatePart` receives a running `ToolPart` with `tool = "bash"` (existing test)
- **THEN** the existing assertion is amended to also expect `display` to be present with a non-null label

---

### Requirement: Copilot unknown tool names are humanized in the default display case

#### Scenario: unknown Copilot tool has underscores replaced with spaces
- **WHEN** a Copilot stream emits `tool.execution_start` for an unknown tool `"my_custom_tool"`
- **THEN** the collected `tool_start` engine event has `display.label = "my custom tool"`

---

### Requirement: Playwright renders tool labels containing spaces without breaking

#### Scenario: humanized MCP label renders in `.tc__tool-name`
- **WHEN** a `tool_call` stream event with `display.label = "other-server do thing"` is pushed via WebSocket mock
- **THEN** `.conv-body .tc__tool-name` contains the text `"other-server do thing"`
