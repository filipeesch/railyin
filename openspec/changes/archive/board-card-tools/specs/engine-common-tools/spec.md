## MODIFIED Requirements

### Requirement: Common tools are task management handlers shared across all engines
The system SHALL extract shared tool handlers into a common module at `src/bun/engine/common-tools.ts` and SHALL register those tools uniformly across all engines. The shared tools SHALL include: card tools `create_card`, `edit_card`, `delete_card`, `move_card`, `message_card`, `get_card`, `list_cards`, `list_boards`, and `get_board_summary`; todo tools `create_todo`, `edit_todo`, `update_todo_status`, `list_todos`, `get_todo`, and `reorganize_todos`; decision tools `decision_request`, `record_decision`, `list_decisions`, `update_decision`, and `delete_decision`; and interaction tool `ask_user`. The tool previously named `interview_me` SHALL be renamed to `decision_request` in all registrations. For the Claude engine, those tools SHALL be registered through the Claude SDK while Claude built-in tools continue to own file, shell, search, edit, and agent operations.

#### Scenario: Common tools are available in native engine
- **WHEN** the native engine runs an execution in a column that includes interactions in its tools config
- **THEN** shared tools including `decision_request` are offered alongside native engine tools

#### Scenario: Common tools are available in Copilot engine
- **WHEN** the Copilot engine runs an execution
- **THEN** shared tools including `decision_request` are registered via mapped common tool definitions without engine-exclusive duplicates

#### Scenario: Common tools are available in Claude engine
- **WHEN** the Claude engine runs an execution
- **THEN** shared tools including `decision_request` are registered with the SDK and available for model calls

#### Scenario: Common tool execution returns consistent results across engines
- **WHEN** `decision_request` is called with questions and optional context from any engine
- **THEN** shared execution invokes a common interview callback contract and produces equivalent waiting-user behavior across engines

## REMOVED Requirements

### Requirement: Old card tool names
The old tool names `create_task`, `edit_task`, `delete_task`, `move_task`, `message_task`, `get_task`, `list_tasks` SHALL NOT be available. These are replaced by card-named equivalents.

**Reason**: Renamed to card terminology for clarity — "task" collides with the internal Task domain concept.
**Migration**: Agents must use the new card-named tools. No backward compatibility aliases are provided.
