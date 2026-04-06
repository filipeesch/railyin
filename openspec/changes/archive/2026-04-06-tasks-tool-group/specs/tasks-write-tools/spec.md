## ADDED Requirements

### Requirement: create_task places a new task in the backlog
The system SHALL provide a `create_task` tool that creates a new task in the backlog column of a board. Required parameters are `project_id`, `title`, and `description`. Optional parameters are `board_id` (defaults to the current executing task's board when omitted) and `model` (overrides the workspace-level AI model for this task). The tool SHALL return the newly created Task record. The tool SHALL be a member of the `tasks_write` tool group.

#### Scenario: Task created on current board when board_id omitted
- **WHEN** an agent calls `create_task` with `project_id`, `title`, and `description` but no `board_id`
- **THEN** a new task is created in the backlog column of the current task's board and the new Task is returned

#### Scenario: Task created on a specified board
- **WHEN** an agent calls `create_task` with a valid `board_id`
- **THEN** the task is created on the specified board

#### Scenario: Model override stored on created task
- **WHEN** an agent calls `create_task` with a `model` parameter
- **THEN** the created task's `model` field is set to that value and all future executions for that task use it

#### Scenario: Invalid board_id returns error
- **WHEN** an agent calls `create_task` with a `board_id` that does not exist
- **THEN** the tool returns a descriptive error and no task is created

### Requirement: edit_task updates title and/or description before worktree exists
The system SHALL provide an `edit_task` tool that updates a task's `title` and/or `description`. The tool SHALL enforce the same pre-worktree lock as the UI: if the task's `worktree_status` is `creating` or `ready`, the tool SHALL return an error and make no changes. The tool SHALL be a member of the `tasks_write` tool group.

#### Scenario: Title and description updated when worktree not yet created
- **WHEN** an agent calls `edit_task` on a task with `worktree_status: "not_created"`
- **THEN** the task's title and/or description are updated and the updated Task is returned

#### Scenario: Edit rejected when worktree exists
- **WHEN** an agent calls `edit_task` on a task with `worktree_status: "ready"` or `"creating"`
- **THEN** the tool returns an error explaining that edits are locked once a branch has been created, and no changes are made

#### Scenario: Unknown task_id returns error
- **WHEN** an agent calls `edit_task` with a `task_id` that does not exist
- **THEN** the tool returns a descriptive error string

### Requirement: delete_task fully removes a task and its associated data
The system SHALL provide a `delete_task` tool that deletes a task. If the task's `execution_state` is `running`, the tool SHALL cancel the execution first then proceed with deletion. Deletion SHALL cascade to remove all related DB records and the worktree directory (using `git worktree remove --force`). The git branch SHALL be kept. The tool SHALL allow an agent to delete its own currently-executing task. The tool SHALL be a member of the `tasks_write` tool group.

#### Scenario: Idle task is deleted with full cascade
- **WHEN** an agent calls `delete_task` on a task with `execution_state: "idle"`
- **THEN** the task, its conversation messages, executions, git context, and conversation records are removed from the database and the worktree directory is removed

#### Scenario: Running task is cancelled then deleted
- **WHEN** an agent calls `delete_task` on a task with `execution_state: "running"`
- **THEN** the running execution is cancelled, then the full cascade deletion proceeds

#### Scenario: Git branch is preserved on delete
- **WHEN** `delete_task` completes
- **THEN** the git branch associated with the task is NOT deleted

#### Scenario: Agent may delete itself
- **WHEN** an agent calls `delete_task` with its own `task_id`
- **THEN** deletion proceeds; the engine detects the missing task after the tool call and terminates the execution loop gracefully

#### Scenario: Unknown task_id returns error
- **WHEN** an agent calls `delete_task` with a `task_id` that does not exist
- **THEN** the tool returns a descriptive error string

### Requirement: move_task transitions a task to a new workflow column asynchronously
The system SHALL provide a `move_task` tool that updates a task's `workflow_state` to a target column and triggers the column's `on_enter_prompt` execution asynchronously (fire-and-forget). The tool SHALL return success immediately after updating the DB without waiting for the execution to begin or complete. Moving to the `backlog` column SHALL be permitted. An agent MAY move its own task. The tool SHALL be a member of the `tasks_write` tool group.

#### Scenario: workflow_state updated immediately
- **WHEN** an agent calls `move_task` with a valid `task_id` and `workflow_state`
- **THEN** the task's `workflow_state` is updated in the database and the tool returns success without waiting for execution

#### Scenario: on_enter_prompt triggered asynchronously
- **WHEN** an agent calls `move_task` to a column that has an `on_enter_prompt` configured
- **THEN** a new execution is triggered for that column asynchronously; the calling agent does not block on it

#### Scenario: Move to backlog is permitted
- **WHEN** an agent calls `move_task` with `workflow_state: "backlog"`
- **THEN** the task moves to the backlog column and the tool returns success

#### Scenario: Agent may move itself
- **WHEN** an agent calls `move_task` with its own `task_id`
- **THEN** the task's workflow_state is updated and the on_enter_prompt for the new column fires asynchronously

#### Scenario: Unknown workflow_state returns error
- **WHEN** an agent calls `move_task` with a `workflow_state` value that does not match any column in the board's workflow template
- **THEN** the tool returns a descriptive error and no state change occurs

#### Scenario: Unknown task_id returns error
- **WHEN** an agent calls `move_task` with a `task_id` that does not exist
- **THEN** the tool returns a descriptive error string
