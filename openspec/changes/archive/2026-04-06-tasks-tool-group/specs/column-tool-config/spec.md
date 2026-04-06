## ADDED Requirements

### Requirement: tasks_read and tasks_write are valid tool group names in column config
The system SHALL recognise `tasks_read` and `tasks_write` as named tool groups in the `TOOL_GROUPS` registry. Workflow column definitions MAY include either name in their `tools` array, giving the AI model in that column read-only or read-write access to board data respectively.

#### Scenario: Column with tasks_read grants only read tools
- **WHEN** a column defines `tools: [tasks_read]`
- **THEN** the AI request for that column includes `get_task`, `get_board_summary`, and `list_tasks` tool definitions

#### Scenario: Column with tasks_write grants only write tools
- **WHEN** a column defines `tools: [tasks_write]`
- **THEN** the AI request for that column includes `create_task`, `edit_task`, `delete_task`, and `move_task` tool definitions

#### Scenario: Column combining tasks_read and tasks_write grants all task tools
- **WHEN** a column defines `tools: [tasks_read, tasks_write]`
- **THEN** the AI request includes all seven task tools without duplicates

#### Scenario: tasks_read and tasks_write validated at config load
- **WHEN** a column's `tools` array contains `tasks_read` or `tasks_write`
- **THEN** no warning is logged (both are known group names)
