## ADDED Requirements

### Requirement: CommonToolContext includes an optional lspManager field
The system SHALL add `lspManager?: LSPServerManager` to the `CommonToolContext` interface in `src/bun/engine/types.ts`. The field is optional so engines without LSP support (or with LSP bridged via MCP) can omit it.

#### Scenario: Native engine populates lspManager in context
- **WHEN** the native engine runs an execution with LSP configured
- **THEN** `CommonToolContext.lspManager` is set to the task's registry manager

#### Scenario: Context without lspManager degrades gracefully
- **WHEN** `executeCommonTool("lsp", ...)` is called with no `lspManager` in context
- **THEN** it returns "Error: LSP is not configured. Add lsp.servers to workspace.yaml."

## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract shared tool handlers into a common module at src/bun/engine/common-tools.ts and SHALL register those tools uniformly across all engines. The shared tools SHALL include task tools create_task, edit_task, delete_task, move_task, message_task, get_task, list_tasks, and get_board_summary; todo tools create_todo, edit_todo, update_todo_status, list_todos, get_todo, and reorganize_todos; interaction tool interview_me; and code intelligence tool lsp. Note: `delete_todo` and `reprioritize_todos` have been removed — deletion is handled via `update_todo_status(..., 'deleted')` and reordering via `reorganize_todos`. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes interactions in its tools config
- **THEN** shared tools including interview_me and lsp are offered alongside native engine tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** shared tools including interview_me and lsp are registered via mapped common tool definitions without engine-exclusive duplicates

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** shared tools including interview_me are registered with the SDK and lsp is available via the MCP bridge

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** interview_me is called with questions and optional context from any engine
- **THEN** shared execution invokes a common interview callback contract and produces equivalent waiting-user behavior across engines

### Requirement: Common tool handlers receive a context object
Each common tool handler SHALL receive a CommonToolContext containing taskId, boardId, lspManager, and execution callbacks required for shared behavior. The context SHALL include transition, human-turn, cancellation, and interview suspension callbacks so shared tools can trigger consistent orchestration outcomes across engines.

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine executes a common tool call
- **THEN** it passes CommonToolContext including lspManager and interview suspension callback to shared tool execution

#### Scenario: Context populated by Claude engine
- **WHEN** the Claude engine executes a common tool call
- **THEN** it passes CommonToolContext including interview suspension callback to shared tool execution (lspManager is null; LSP is handled via MCP bridge)
