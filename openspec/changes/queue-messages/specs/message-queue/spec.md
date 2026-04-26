## ADDED Requirements

### Requirement: User can queue messages while assistant is running
The system SHALL allow users to compose and queue follow-up messages while an assistant turn is active. Queued messages SHALL be stored per-conversation (task or session) and SHALL persist across drawer close and reopen within the same browser session.

#### Scenario: Queue message while running
- **WHEN** a task or chat session has `executionState === "running"` or `status === "running"`
- **THEN** the conversation input editor SHALL be enabled (not disabled)
- **AND** a queue button (distinct from the normal send button) SHALL be visible alongside the stop button

#### Scenario: Message appears as badge chip
- **WHEN** the user types a message and presses the queue button (or Enter) while the assistant is running
- **THEN** the message SHALL appear as a badge chip above the input editor
- **AND** the editor SHALL be cleared for the next message
- **AND** the chip SHALL display the raw typed text truncated to ~60 characters

#### Scenario: Multiple messages can be queued
- **WHEN** the user queues more than one message while the assistant is running
- **THEN** all messages SHALL appear as numbered badge chips in FIFO order
- **AND** each chip SHALL show its position number (#1, #2, etc.)

### Requirement: Queue drains automatically as a single batched message
When an assistant turn ends, the system SHALL send all queued messages as a single combined message in one API call. Messages SHALL be joined with `"\n\n---\n\n"` as separator. The `engineText` fields SHALL be joined the same way.

#### Scenario: Batch send on completion
- **WHEN** an assistant turn ends (stream `done` event received)
- **AND** one or more messages are queued for that conversation
- **THEN** exactly one `sendMessage` API call SHALL be made with all queued messages concatenated
- **AND** the queue SHALL be cleared after the send

#### Scenario: No send when queue is empty
- **WHEN** an assistant turn ends
- **AND** no messages are queued
- **THEN** no additional `sendMessage` call SHALL be made

#### Scenario: Auto-send fires regardless of drawer state
- **WHEN** an assistant turn ends with queued messages
- **AND** the task/session drawer is closed
- **THEN** the queued messages SHALL still be sent automatically

### Requirement: Queue is isolated per conversation
Each task and each chat session SHALL maintain its own independent queue. Queuing a message for task A SHALL NOT affect task B or any chat session.

#### Scenario: Queue isolation between tasks
- **WHEN** task A has 2 queued messages and task B has 0
- **THEN** completing task A's turn SHALL send task A's 2 messages
- **AND** task B's queue SHALL remain empty

### Requirement: User can cancel a queued message
The system SHALL allow users to remove individual messages from the queue before they are sent.

#### Scenario: Cancel queued message via chip ✕
- **WHEN** the user clicks the ✕ button on a queued message chip
- **THEN** that message SHALL be removed from the queue
- **AND** the remaining chips SHALL renumber

### Requirement: User can edit a queued message
The system SHALL allow users to edit a queued message by loading it back into the input editor at its original queue position.

#### Scenario: Edit chip restores text to editor
- **WHEN** the user clicks the ✏ button on a queued message chip
- **THEN** the chip's raw text (including CM6 chip tokens) SHALL be loaded into the input editor
- **AND** a ghost "editing..." placeholder SHALL replace the chip in the badge area
- **AND** CodeMirror chip tokens (file refs, slash prompts, MCP tools) SHALL be rendered as visual pills automatically

#### Scenario: Re-queue after edit preserves position
- **WHEN** the user edits a chip that was at position #2
- **AND** presses the queue button after editing
- **THEN** the updated message SHALL be re-inserted at position #2 (original index)

### Requirement: Queue appends to interview and ask_user answers
When the user answers an `interview_me` or `ask_user_prompt` widget, any queued messages SHALL be appended to the answer in a single send, then the queue SHALL be cleared.

#### Scenario: Interview answer includes queue
- **WHEN** the user submits an interview answer
- **AND** there are queued messages for that conversation
- **THEN** exactly one `sendMessage` call SHALL be made with the answer followed by a `"\n\n---\n\n"` separator and all queued messages concatenated
- **AND** the queue SHALL be cleared

#### Scenario: Interview answer with empty queue
- **WHEN** the user submits an interview answer
- **AND** there are no queued messages
- **THEN** the answer SHALL be sent as-is (unchanged behavior)

### Requirement: Queue is preserved on execution failure or cancellation
If an execution fails or is cancelled, queued messages SHALL NOT be automatically sent and SHALL remain visible as badge chips so the user can review, edit, or discard them manually.

#### Scenario: Queue preserved after failure
- **WHEN** a task's `executionState` transitions to `failed` or `cancelled`
- **AND** there are queued messages for that task
- **THEN** the queued message chips SHALL remain visible in the badge area
- **AND** no automatic send SHALL occur

#### Scenario: Queue preserved after session cancellation
- **WHEN** a chat session execution is cancelled
- **AND** there are queued messages for that session
- **THEN** the queued message chips SHALL remain visible

### Requirement: Queue is frozen during waiting_user state
The system SHALL NOT drain the queue when the assistant transitions to `waiting_user` state (i.e., the AI asked the user a question). The queue SHALL remain frozen until the next `done` event fires after the user answers.

#### Scenario: Queue not sent on waiting_user
- **WHEN** a task or session enters `waiting_user` state
- **AND** there are queued messages
- **THEN** no automatic send SHALL occur
- **AND** chips SHALL display a visual frozen indicator (e.g., pause icon or tooltip)
