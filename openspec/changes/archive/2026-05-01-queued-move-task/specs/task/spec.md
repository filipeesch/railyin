## MODIFIED Requirements

### Requirement: Board card reflects execution state in real time
The system SHALL push task state updates to the board card immediately when execution state changes, without requiring a manual refresh. The system SHALL track unread activity per task and surface meaningful unseen activity through both a card-level unread indicator and a toast notification. The unread indicator SHALL only be set when a task's execution state transitions to a terminal value — it SHALL NOT be set mid-stream while tokens are arriving.

#### Scenario: Task completion shows unread and toast
- **WHEN** a task's `execution_state` transitions to `completed` and that transition has not yet been seen
- **THEN** the task card becomes unread
- **AND** the user sees a toast notification identifying the workspace and task that completed

#### Scenario: Task failure shows unread and toast
- **WHEN** a task's `execution_state` transitions to `failed` and that transition has not yet been seen
- **THEN** the task card becomes unread
- **AND** the user sees a warning toast identifying the workspace and task that failed

#### Scenario: Waiting for user shows unread (no toast)
- **WHEN** a task's `execution_state` transitions to `waiting_user` and that transition has not yet been seen
- **THEN** the task card becomes unread
- **AND** no toast is shown (the task is awaiting user input, not autonomously completing)

#### Scenario: First snapshot does not trigger toast
- **WHEN** task data is loaded from RPC for the first time with no prior local snapshot
- **THEN** the system does NOT show a toast notification for that initial state

#### Scenario: Opening task clears unread state
- **WHEN** the user opens a task that has unread activity
- **THEN** that task's unread state is cleared

#### Scenario: Streaming tokens do NOT set unread
- **WHEN** the AI is streaming tokens for a background task and the task card is not the active one
- **THEN** the unread indicator is NOT set during streaming
- **AND** the unread indicator is set only when the execution reaches a terminal state

#### Scenario: Column move does NOT set unread
- **WHEN** a task's `workflow_state` changes (column move, including deferred prompt trigger)
- **THEN** the unread indicator is NOT set from the column move itself

## ADDED Requirements

### Requirement: TransitionExecutor returns authoritative running state
After `TransitionExecutor.execute()` sets `execution_state = 'running'` and starts a new execution, the returned `Task` object in the RPC response SHALL reflect `execution_state = 'running'`, not the prior `idle` state.

#### Scenario: Badge shows Running immediately after transition
- **WHEN** a user moves a task to a column with an `on_enter_prompt` and the response is received
- **THEN** the task card badge updates to `Running…` without waiting for the next WebSocket `task.updated` event
