## ADDED Requirements

### Requirement: Task has two independent state dimensions
Each task SHALL maintain two distinct state fields: `workflow_state` representing its position in the board workflow, and `execution_state` representing the operational status of the current execution within that column. These states are updated independently.

#### Scenario: Workflow state updates immediately on transition
- **WHEN** a user moves a task to a new column
- **THEN** `workflow_state` updates immediately to the target column's ID before any execution begins

#### Scenario: Execution state reflects operational status
- **WHEN** the on_enter_prompt execution for a column completes with status `waiting_user`
- **THEN** `execution_state` becomes `waiting_user` while `workflow_state` remains the current column

#### Scenario: Both states displayed together
- **WHEN** a task card is shown on the board
- **THEN** both `workflow_state` (column) and `execution_state` (badge) are visible simultaneously

### Requirement: Task owns a persistent conversation
Each task SHALL own exactly one conversation. All executions, retries, user messages, assistant responses, transition events, and system messages for that task are appended to this single conversation timeline. The conversation is never reset.

#### Scenario: Conversation persists through transitions
- **WHEN** a task moves from one column to another
- **THEN** the new execution's messages are appended to the existing conversation; prior messages remain visible

#### Scenario: Conversation persists through retries
- **WHEN** a retry is triggered
- **THEN** the retry's messages are appended to the existing conversation with prior attempt messages still visible

### Requirement: Task supports retry in current column
The system SHALL allow a user to retry an execution while keeping the task in its current workflow column. A retry creates a new execution using the current column's configured prompt and appends output to the existing conversation.

#### Scenario: Retry resets execution state to running
- **WHEN** a user triggers retry on a task with execution state `failed` or `waiting_user`
- **THEN** `execution_state` changes to `running` and the column's `on_enter_prompt` is re-executed

#### Scenario: Retry count is incremented
- **WHEN** a retry occurs
- **THEN** the task's `retry_count` is incremented by 1

### Requirement: Task can be created by another task's execution
The system SHALL support task creation from within an execution. Tasks created this way are placed in Backlog, belong to the same board, and store provenance fields linking them to the creating task and execution.

#### Scenario: Spawned task appears in Backlog
- **WHEN** an execution result includes a `created_tasks` array
- **THEN** each entry is created as a new task in the Backlog column with `created_from_task_id` and `created_from_execution_id` set

#### Scenario: Spawned task belongs to a specified project
- **WHEN** a created task specifies `project_id`
- **THEN** the new task is assigned to that project; if no project is specified, it defaults to the originating task's project

### Requirement: Task detail view shows full timeline and metadata
The system SHALL provide a task detail view containing the full conversation timeline, task metadata, worktree information, and execution history. This is the primary surface for deep task inspection.

#### Scenario: Task detail shows all message types
- **WHEN** a user opens a task detail view
- **THEN** the conversation timeline shows user messages, assistant messages, tool calls, tool results, transition events, and system messages in chronological order

#### Scenario: Task detail shows current execution state
- **WHEN** a task is in `running` execution state
- **THEN** the detail view shows a real-time streaming indicator as tokens arrive
