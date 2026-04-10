## ADDED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract board/task management tool handlers into a shared module (`src/bun/engine/common-tools.ts`). These tools SHALL be the only tools registered across all engines. The common tools are: `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_task`, `list_tasks`, and `get_board_summary`.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes `interactions` in its tools config
- **THEN** the common tools are offered to the model alongside the native engine's own tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** the common tools are registered via `defineTool()` and available for the model to call

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** `create_task` is called with `{ title: "Fix bug", board_id: 1 }` from any engine
- **THEN** the same task is created in the database and the same result format is returned

### Requirement: Common tool metadata includes name, description, and input schema
Each common tool SHALL export metadata containing: `name` (string), `description` (string), and `inputSchema` (JSON Schema object). This metadata SHALL be engine-agnostic — each engine adapter wraps it in its native tool format.

#### Scenario: Native engine uses metadata for tool definitions
- **WHEN** the native engine constructs tool definitions for an AI request
- **THEN** it uses the common tool metadata to build `AIToolDefinition` objects

#### Scenario: Copilot engine uses metadata for defineTool
- **WHEN** the Copilot engine registers common tools with the SDK
- **THEN** it converts the JSON Schema from metadata into Zod schemas for `defineTool()`

### Requirement: Common tool handlers receive a context object
Each common tool handler function SHALL receive a `CommonToolContext` containing: `taskId` (number), `boardId` (number), `projectId` (number | null), and database access. This context is populated by the engine adapter before calling the handler.

#### Scenario: Context populated by native engine
- **WHEN** the native engine intercepts a `create_task` tool call
- **THEN** it constructs `CommonToolContext` from the current execution's task and passes it to the handler

#### Scenario: Context populated by Copilot engine
- **WHEN** the Copilot engine receives a `create_task` tool call via SDK callback
- **THEN** it constructs `CommonToolContext` from the execution params and passes it to the handler

### Requirement: All non-common tools remain engine-internal
Tools not in the common tools set (file ops, shell, search, LSP, todos, ask_me, spawn_agent, fetch_url, search_internet) SHALL remain internal to the engine that defines them. The native engine SHALL continue to own all 30+ tools. The Copilot engine SHALL rely on the SDK's built-in tools for file, shell, git, and search operations.

#### Scenario: Native engine retains all its tools
- **WHEN** the native engine constructs tool definitions
- **THEN** all existing tools (read_file, write_file, patch_file, run_command, etc.) are available as before

#### Scenario: Copilot engine does not register native-only tools
- **WHEN** the Copilot engine creates a session
- **THEN** it does NOT register `read_file`, `write_file`, `run_command`, or other file/shell tools — the SDK provides equivalents
