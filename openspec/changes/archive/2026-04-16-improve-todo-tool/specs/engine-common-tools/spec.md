## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract board/task management tool handlers into a shared module (`src/bun/engine/common-tools.ts`). These tools SHALL be the only tools registered across all engines. The common tools are: `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_task`, `list_tasks`, `get_board_summary`, `create_todo`, `edit_todo`, `delete_todo`, `list_todos`, `get_todo`, and `reprioritize_todos`. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude's own built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes `interactions` in its tools config
- **THEN** the common tools are offered to the model alongside the native engine's own tools, including all todo tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** the common tools are registered via `defineTool()` and available for the model to call, including all todo tools

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** the shared task-management tools including todo tools are registered with the SDK and available for the model to call

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** `create_todo` is called with `{ number: 1.0, title: "Setup DB", description: "..." }` from any engine
- **THEN** the same todo is created in the database and the same result format is returned
