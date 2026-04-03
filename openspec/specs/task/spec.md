## Purpose
The task detail view is the primary surface for interacting with a task — reviewing its conversation history, sending messages, and managing transitions.

## Requirements

### Requirement: Task has two independent state dimensions
Each task SHALL maintain two distinct state fields: `workflow_state` representing its position in the board workflow, and `execution_state` representing the operational status of the current execution within that column. These states are updated independently. Valid `execution_state` values are: `idle`, `running`, `waiting_user`, `waiting_external`, `failed`, `completed`, and `cancelled`.

#### Scenario: Workflow state updates immediately on transition
- **WHEN** a user moves a task to a new column
- **THEN** `workflow_state` updates immediately to the target column's ID before any execution begins

#### Scenario: Execution state reflects operational status
- **WHEN** the on_enter_prompt execution for a column completes with status `waiting_user`
- **THEN** `execution_state` becomes `waiting_user` while `workflow_state` remains the current column

#### Scenario: Both states displayed together
- **WHEN** a task card is shown on the board
- **THEN** both `workflow_state` (column) and `execution_state` (badge) are visible simultaneously

#### Scenario: Cancelled execution reflected on task
- **WHEN** a running execution is cancelled
- **THEN** `execution_state` transitions to `waiting_user` (via the transient `cancelled` execution status)

### Requirement: Task stores a model override
Each task SHALL have an optional `model` field that overrides the workspace-level model for all AI executions run in the context of that task.

#### Scenario: Task model used when set
- **WHEN** a task has a non-null `model` field and an execution is triggered
- **THEN** the AI provider is created with the task's model value

#### Scenario: Workspace model used when task model is null
- **WHEN** a task's `model` field is null
- **THEN** the workspace-level `ai.model` is used for all executions

### Requirement: Task exposes git context fields
The `Task` domain type SHALL include `worktreeStatus`, `branchName`, and `worktreePath` populated from `task_git_context`.

#### Scenario: Git context fields available on Task
- **WHEN** a task is fetched via any tasks RPC
- **THEN** the returned Task object includes `worktreeStatus`, `branchName`, and `worktreePath` (nullable if not yet set)

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

### Requirement: Task detail drawer is resizable
The system SHALL allow the user to resize the task detail drawer by dragging its left edge. The chosen width SHALL persist for the duration of the session.

#### Scenario: Drawer resized by dragging
- **WHEN** the user drags the left edge of the task detail drawer
- **THEN** the drawer width updates in real time between a minimum of 480px and a maximum of 1400px

#### Scenario: Width persists until app restart
- **WHEN** the user resizes the drawer and then navigates away and back
- **THEN** the drawer opens at the last chosen width within the same session

### Requirement: Chat input supports multi-line messages
The system SHALL allow the user to insert newlines in the chat input by pressing Shift+Enter, while pressing Enter alone sends the message.

#### Scenario: Shift+Enter inserts newline
- **WHEN** the user presses Shift+Enter in the chat input
- **THEN** a newline is inserted and the input expands

#### Scenario: Enter sends the message
- **WHEN** the user presses Enter without Shift
- **THEN** the current message content is sent

### Requirement: Conversation auto-scrolls to latest message
The system SHALL automatically scroll the conversation timeline to the bottom as new messages or tokens arrive. Auto-scroll SHALL pause when the user scrolls up and resume when they scroll back near the bottom.

#### Scenario: Auto-scroll active during streaming
- **WHEN** tokens are arriving and the user has not scrolled up
- **THEN** the view auto-scrolls to show the latest token

#### Scenario: Auto-scroll pauses when user scrolls up
- **WHEN** the user scrolls up while the model is streaming
- **THEN** auto-scroll is suspended and the view stays at the user's scroll position

#### Scenario: Auto-scroll resumes at bottom
- **WHEN** the user scrolls back to within 60px of the bottom
- **THEN** auto-scroll resumes automatically

### Requirement: Board card reflects execution state in real time
The system SHALL push task state updates to the board card immediately when execution state changes, without requiring a manual refresh.

#### Scenario: Card flips to running when message is sent
- **WHEN** the user sends a message in the chat drawer
- **THEN** the board card execution badge updates to reflect `running` state immediately

#### Scenario: Card flips to completed when stream finishes
- **WHEN** the AI finishes its response
- **THEN** the board card execution badge updates to `completed`
