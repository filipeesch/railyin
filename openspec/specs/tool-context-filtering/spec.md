## ADDED Requirements

### Requirement: Task-scoped tools are excluded from chat session tool sets
The system SHALL exclude task-scoped tools from the tool set when `taskId` is `null` (chat session context). Task-scoped tools are those that require `ctx.task.id` to function: `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, `update_todo_status`.

#### Scenario: Todo tools excluded when taskId is null
- **WHEN** a chat session execution starts with `taskId: null`
- **THEN** the tool set does not include `create_todo`, `edit_todo`, `list_todos`, `get_todo`, `reorganize_todos`, or `update_todo_status`

#### Scenario: Todo tools included when taskId is set
- **WHEN** a task execution starts with `taskId: 42`
- **THEN** the tool set includes all todo tools

#### Scenario: Other common tools remain available in chat sessions
- **WHEN** a chat session execution starts
- **THEN** note tools (`create_note`, `list_notes`, `update_note`), decision tools, board tools, and workspace tools remain available

### Requirement: TODO_TOOL_NAMES set is the source of truth for task-scoped tools
The system SHALL define a `TODO_TOOL_NAMES` constant set in `src/bun/engine/common-tools.ts` listing all task-scoped tool names. Engine tool builders SHALL use this set when filtering.

#### Scenario: TODO_TOOL_NAMES contains all task-scoped tools
- **WHEN** `TODO_TOOL_NAMES` is inspected
- **THEN** it includes `"create_todo"`, `"edit_todo"`, `"list_todos"`, `"get_todo"`, `"reorganize_todos"`, and `"update_todo_status"`

#### Scenario: Filter uses TODO_TOOL_NAMES set
- **WHEN** an engine tool builder filters task-scoped tools
- **THEN** it checks against `TODO_TOOL_NAMES.has(toolName)` rather than a hardcoded list

### Requirement: Pi engine filters task-scoped tools in buildCommonTools
The Pi engine's `buildCommonTools()` function in `src/bun/engine/pi/tools/common.ts` SHALL exclude task-scoped tools when `ctx.task.id` is `null`.

#### Scenario: Pi engine excludes todo tools for chat sessions
- **WHEN** `buildCommonTools()` is called with `ctx.task.id === null`
- **THEN** the returned `AgentTool[]` does not include any tool whose name is in `TODO_TOOL_NAMES`

#### Scenario: Pi engine includes todo tools for task executions
- **WHEN** `buildCommonTools()` is called with `ctx.task.id !== null`
- **THEN** the returned `AgentTool[]` includes all task-scoped tools

### Requirement: Copilot engine filters task-scoped tools in buildCopilotTools
The Copilot engine's `buildCopilotTools()` function in `src/bun/engine/copilot/tools.ts` SHALL exclude task-scoped tools when `context.task.id` is `null`.

#### Scenario: Copilot engine excludes todo tools for chat sessions
- **WHEN** `buildCopilotTools()` is called with `context.task.id === null`
- **THEN** the returned `Tool[]` does not include any task-scoped tool

#### Scenario: Copilot engine includes todo tools for task executions
- **WHEN** `buildCopilotTools()` is called with `context.task.id !== null`
- **THEN** the returned `Tool[]` includes all task-scoped tools

### Requirement: Claude engine filters task-scoped tools in buildTools
The Claude engine's `buildTools()` function in `src/bun/engine/claude/tools.ts` SHALL exclude task-scoped tools when `context.task.id` is `null`.

#### Scenario: Claude engine excludes todo tools for chat sessions
- **WHEN** `buildTools()` is called with `context.task.id === null`
- **THEN** the returned tool list does not include any task-scoped tool

### Requirement: Cursor engine filters task-scoped tools in buildCursorTools
The Cursor engine's `buildCursorTools()` function in `src/bun/engine/cursor/tools.ts` SHALL exclude task-scoped tools when `context.task.id` is `null`.

#### Scenario: Cursor engine excludes todo tools for chat sessions
- **WHEN** `buildCursorTools()` is called with `context.task.id === null`
- **THEN** the returned tool list does not include any task-scoped tool

### Requirement: OpenCode MCP server filters task-scoped tools in tools/list
The OpenCode MCP server's `tools/list` endpoint SHALL exclude task-scoped tools when the active execution context has `taskId: null`.

#### Scenario: OpenCode excludes todo tools for chat sessions
- **WHEN** `tools/list` is called and the active context entry has `commonToolContext.task.id === null`
- **THEN** the returned tool list does not include task-scoped tools

#### Scenario: OpenCode includes todo tools for task executions
- **WHEN** `tools/list` is called and the active context entry has `commonToolContext.task.id !== null`
- **THEN** the returned tool list includes all task-scoped tools

### Requirement: Unit tests verify tool filtering across all engines
The system SHALL include unit tests in `src/bun/test/tool-context-filtering.test.ts` verifying that task-scoped tools are filtered from chat session tool sets. Tests SHALL follow the existing `common-tools-registration.test.ts` pattern.

#### Scenario: TCF-1 — TODO_TOOL_NAMES contains all 6 task-scoped tool names
- **WHEN** `TODO_TOOL_NAMES` is inspected
- **THEN** it contains exactly `"create_todo"`, `"edit_todo"`, `"list_todos"`, `"get_todo"`, `"reorganize_todos"`, and `"update_todo_status"`

#### Scenario: TCF-2 — Pi engine excludes todo tools for chat sessions
- **WHEN** `buildCommonTools()` is called with `ctx.task.id === null`
- **THEN** the returned tools do not include any name in `TODO_TOOL_NAMES`

#### Scenario: TCF-3 — Pi engine includes todo tools for task executions
- **WHEN** `buildCommonTools()` is called with `ctx.task.id === 1`
- **THEN** the returned tools include all names in `TODO_TOOL_NAMES`

#### Scenario: TCF-4 — Copilot engine excludes todo tools for chat sessions
- **WHEN** `buildCopilotTools()` is called with `context.task.id === null`
- **THEN** the returned tools do not include any name in `TODO_TOOL_NAMES`

#### Scenario: TCF-5 — Copilot engine includes todo tools for task executions
- **WHEN** `buildCopilotTools()` is called with `context.task.id === 1`
- **THEN** the returned tools include all names in `TODO_TOOL_NAMES`

#### Scenario: TCF-6 — Claude engine excludes todo tools for chat sessions
- **WHEN** `buildClaudeToolServer()` is called with `context.task.id === null`
- **THEN** the registered tool names do not include any name in `TODO_TOOL_NAMES`

#### Scenario: TCF-7 — Cursor engine excludes todo tools for chat sessions
- **WHEN** `buildCursorTools()` is called with `context.task.id === null`
- **THEN** the returned tools do not include any name in `TODO_TOOL_NAMES`

#### Scenario: TCF-8 — OpenCode MCP server excludes todo tools for chat sessions
- **WHEN** the MCP server's `tools/list` endpoint is called with active context having `taskId: null`
- **THEN** the returned tool list does not include any name in `TODO_TOOL_NAMES`

#### Scenario: TCF-9 — Note/decision/board tools remain available in chat sessions
- **WHEN** a chat session execution starts with `taskId: null`
- **THEN** the tool set includes `create_note`, `list_notes`, `update_note`, `decision_request`, `list_boards`, and `list_cards`
