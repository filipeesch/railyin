## MODIFIED Requirements

### Requirement: Board card reflects execution state in real time
The system SHALL push task state updates to the board card immediately when execution state changes, without requiring a manual refresh. The system SHALL track unread activity per task and surface meaningful unseen activity through both a card-level unread indicator and a toast notification.

#### Scenario: Task completion shows unread and toast
- **WHEN** a task finishes with `execution_state = completed` and that completion has not yet been seen
- **THEN** the task card becomes unread
- **AND** the user sees a toast notification identifying the workspace and task that completed

#### Scenario: Task failure shows unread and toast
- **WHEN** a task changes to `execution_state = failed` and that failure has not yet been seen
- **THEN** the task card becomes unread
- **AND** the user sees a warning toast identifying the workspace and task that failed

#### Scenario: First snapshot does not trigger toast
- **WHEN** task data is loaded from RPC for the first time with no prior local snapshot
- **THEN** the system does NOT show a toast notification for that initial state

#### Scenario: Opening task clears unread state
- **WHEN** the user opens a task that has unread activity
- **THEN** that task's unread state is cleared
