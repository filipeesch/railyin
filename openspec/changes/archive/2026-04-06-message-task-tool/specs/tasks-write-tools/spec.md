## ADDED Requirements

### Requirement: tasks_write group includes message_task
The `tasks_write` tool group SHALL include `message_task` alongside the tools defined in the `tasks-tool-group` change.

#### Scenario: Column with tasks_write grants message_task
- **WHEN** a column defines `tools: [tasks_write]`
- **THEN** the AI request for that column includes `message_task` in addition to `create_task`, `edit_task`, `delete_task`, and `move_task`
