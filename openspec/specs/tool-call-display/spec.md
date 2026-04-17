## Purpose
Defines the ToolCallDisplay interface and the per-engine rules for computing structured display metadata that makes tool calls human-readable in the conversation timeline.

## Requirements

### Requirement: ToolCallDisplay carries structured display metadata for a tool call
The system SHALL define a `ToolCallDisplay` interface in `src/bun/engine/types.ts` with the following fields:
- `label` (string, required) — a human-readable verb describing what the tool does (e.g. `"read"`, `"run"`, `"move task"`)
- `subject` (string, optional) — the primary target of the action (e.g. `"migrations.ts:42"`, `"#5 → done"`, `"src/**"`)
- `contentType` (`"file" | "terminal"`, optional) — semantic hint indicating what kind of data the tool result contains, used by the UI to select the appropriate rendering component
- `startLine` (number, optional) — the starting line for file view rendering, only meaningful when `contentType === "file"`

#### Scenario: ToolCallDisplay provides label and subject for a read tool
- **WHEN** the Claude engine emits `tool_start` for a `Read` call with `file_path: "src/bun/db/migrations.ts"` and `start_line: 42`
- **THEN** the emitted event carries `display: { label: "read", subject: "migrations.ts:42", contentType: "file", startLine: 42 }`

#### Scenario: ToolCallDisplay provides label and subject for a common task tool
- **WHEN** any engine emits `tool_start` for `move_task` with `task_id: 5` and `workflow_state: "done"`
- **THEN** the emitted event carries `display: { label: "move task", subject: "#5 → done" }`

#### Scenario: ToolCallDisplay provides label and subject for a shell tool
- **WHEN** the Claude engine emits `tool_start` for `Bash` with `command: "bun test src/bun/engine"`
- **THEN** the emitted event carries `display: { label: "run", subject: "bun test src/bun/engine", contentType: "terminal" }`

#### Scenario: Unknown tool names produce a minimal display
- **WHEN** an engine emits `tool_start` for a tool name not in any known tool set
- **THEN** the emitted event carries `display: { label: "<tool-name>" }` with no subject or contentType

### Requirement: Each engine builds ToolCallDisplay at tool_start emission time
Each engine implementation SHALL compute `ToolCallDisplay` immediately when emitting a `tool_start` event, using knowledge of its own tool vocabulary. The display SHALL be attached to the event before the orchestrator processes it.

#### Scenario: Claude engine attaches display for built-in tools
- **WHEN** `translateClaudeMessage()` processes an `assistant` message containing a `tool_use` block
- **THEN** the emitted `tool_start` event contains a populated `display` field computed by `buildClaudeBuiltinDisplay()` or `buildCommonToolDisplay()` depending on whether the tool name is in `COMMON_TOOL_NAMES`

#### Scenario: Copilot engine attaches display for its tool set
- **WHEN** `translateEvent()` processes a `tool.execution_start` SDK event
- **THEN** the emitted `tool_start` event contains a populated `display` field computed by `buildCommonToolDisplay()` or `buildCopilotNativeDisplay()` depending on whether the tool name is in `COMMON_TOOL_NAMES`

#### Scenario: display field is persisted in the tool_call conversation message
- **WHEN** the orchestrator processes a `tool_start` event with a `display` field
- **THEN** the JSON stored in the `content` column of the `conversation_messages` row for that `tool_call` includes the `display` object

#### Scenario: Orchestrator does not interpret or transform display
- **WHEN** the orchestrator serializes a `tool_start` event into a `tool_call` message
- **THEN** it passes `display` through as-is with no business logic applied
