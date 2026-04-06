## ADDED Requirements

### Requirement: get_task returns full task metadata with optional conversation messages
The system SHALL provide a `get_task` tool that returns the Task record for a given `task_id`. When an optional `include_messages` integer parameter is provided, the tool SHALL also return the last N messages from the task's conversation in chronological order. The tool SHALL be a member of the `tasks_read` tool group.

#### Scenario: Basic task fetch returns metadata
- **WHEN** an agent calls `get_task` with a valid `task_id`
- **THEN** the tool returns the task's title, description, workflow_state, execution_state, model, branch_name, worktree_status, and execution_count

#### Scenario: include_messages returns last N chronological messages
- **WHEN** an agent calls `get_task` with `task_id` and `include_messages: 10`
- **THEN** the tool returns the task metadata plus the last 10 messages from its conversation in chronological order (oldest first)

#### Scenario: Unknown task_id returns error
- **WHEN** an agent calls `get_task` with a `task_id` that does not exist
- **THEN** the tool returns a descriptive error string and no task data

### Requirement: get_board_summary returns per-column task counts
The system SHALL provide a `get_board_summary` tool that returns a snapshot of task distribution across all columns of a board. The response SHALL include, per column: column id, column name, total task count, and a breakdown by execution_state (running, waiting_user, failed, idle). The `board_id` parameter SHALL be optional; when omitted the tool SHALL use the current executing task's board. The tool SHALL be a member of the `tasks_read` tool group.

#### Scenario: Summary returns counts for current board
- **WHEN** an agent calls `get_board_summary` without a `board_id`
- **THEN** the tool returns a summary of all columns on the current task's board with task counts per column and per execution_state

#### Scenario: Summary returns counts for a specified board
- **WHEN** an agent calls `get_board_summary` with a valid `board_id`
- **THEN** the tool returns the summary for the specified board

#### Scenario: Unknown board_id returns error
- **WHEN** an agent calls `get_board_summary` with a `board_id` that does not exist
- **THEN** the tool returns a descriptive error string

### Requirement: list_tasks filters and searches tasks on a board
The system SHALL provide a `list_tasks` tool that returns an array of Task records. It SHALL accept the following optional filter parameters: `board_id` (omit = current task's board), `workflow_state` (exact match on column id), `execution_state` (exact match), `project_id`, `query` (case-insensitive substring match against title and description), and `limit` (default 50, maximum 200). Results SHALL be ordered by `created_at` ascending. The tool SHALL be a member of the `tasks_read` tool group.

#### Scenario: List all tasks on current board
- **WHEN** an agent calls `list_tasks` with no parameters
- **THEN** the tool returns up to 50 tasks from the current task's board ordered by creation time

#### Scenario: Filter by workflow_state
- **WHEN** an agent calls `list_tasks` with `workflow_state: "in-progress"`
- **THEN** only tasks in the "in-progress" column are returned

#### Scenario: Filter by execution_state
- **WHEN** an agent calls `list_tasks` with `execution_state: "failed"`
- **THEN** only tasks with execution_state "failed" are returned

#### Scenario: Text search via query param
- **WHEN** an agent calls `list_tasks` with `query: "auth"`
- **THEN** only tasks whose title or description contains "auth" (case-insensitive) are returned

#### Scenario: Limit caps result count
- **WHEN** an agent calls `list_tasks` with `limit: 5` and the board has 20 tasks
- **THEN** only 5 tasks are returned

#### Scenario: Multiple filters are ANDed
- **WHEN** an agent calls `list_tasks` with both `workflow_state: "backlog"` and `query: "payment"`
- **THEN** only tasks in "backlog" whose title or description contains "payment" are returned
