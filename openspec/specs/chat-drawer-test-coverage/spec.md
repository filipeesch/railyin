## Purpose
Defines the Playwright E2E test coverage requirements for the chat drawer, including shared helpers, toolbar action guards, session sidebar edge cases, attachment chip rendering, stream state isolation, and legacy/modern timeline coexistence.

## Requirements

### Requirement: Shared Playwright helpers are defined once and imported
The test suite SHALL provide a `e2e/ui/fixtures/helpers.ts` module exporting reusable page-interaction helpers used across multiple spec files. No spec file SHALL re-declare a helper function that already exists in this module.

#### Scenario: openTaskDrawer helper opens the task detail drawer
- **WHEN** a spec calls `openTaskDrawer(page, taskId)`
- **THEN** the `.task-detail` panel becomes visible

#### Scenario: sendMessage helper sends a message via the task chat editor
- **WHEN** a spec calls `sendMessage(page, text)`
- **THEN** the text is typed into `.task-detail__input .cm-content` and submitted with Enter

#### Scenario: openSessionDrawer helper opens a session chat view
- **WHEN** a spec calls `openSessionDrawer(page, sessionId)`
- **THEN** the `.session-chat-view` panel becomes visible

#### Scenario: typeInSessionEditor helper types and submits text in the session editor
- **WHEN** a spec calls `typeInSessionEditor(page, text)`
- **THEN** the text is typed into `.session-chat-view .chat-editor .cm-content` and submitted

### Requirement: Task toolbar action guards are covered by Playwright tests
The test suite SHALL verify that the task toolbar's conditional controls (workflow select, terminal button, code editor button, retry button) are shown or hidden based on task state, and that their interactions produce the expected API calls and DOM side effects.

#### Scenario: Workflow select shows the task's current workflow column
- **WHEN** the task drawer is open for a task in column "in-progress"
- **THEN** the `.workflow-select` element displays "in-progress" as its current value

#### Scenario: Changing workflow select triggers tasks.transition API call
- **WHEN** the user selects a different column from the `.workflow-select`
- **THEN** the `tasks.transition` RPC is called with the selected column id

#### Scenario: Terminal button absent when task has no worktree path
- **WHEN** the task's `worktreePath` is null
- **THEN** no terminal button (`.pi-desktop`) is rendered in the toolbar

#### Scenario: Terminal button present when task has a worktree path
- **WHEN** the task's `worktreePath` is set to a non-null value
- **THEN** the terminal button (`.pi-desktop`) is visible in the toolbar

#### Scenario: Code editor button absent when task has no worktree path
- **WHEN** the task's `worktreePath` is null
- **THEN** no code editor button (`.task-detail__code-btn`) is rendered in the toolbar

#### Scenario: Code editor button present when task has a worktree path
- **WHEN** the task's `worktreePath` is set to a non-null value
- **THEN** the code editor button is visible in the toolbar

#### Scenario: Retry button absent when execution state is not failed
- **WHEN** the task's `executionState` is "idle"
- **THEN** no retry button (`.pi-replay`) is rendered in the toolbar

#### Scenario: Retry button present when execution state is failed
- **WHEN** the task's `executionState` is "failed"
- **THEN** the retry button is visible in the toolbar

#### Scenario: Delete dialog opens on trash button click
- **WHEN** the user clicks the `.pi-trash` button in the drawer header
- **THEN** a dialog with header "Delete task" becomes visible

#### Scenario: Delete dialog cancel closes dialog without API call
- **WHEN** the user opens the delete dialog and clicks the Cancel button
- **THEN** the dialog is dismissed and no `tasks.delete` RPC call is made

#### Scenario: Delete dialog confirm calls tasks.delete API
- **WHEN** the user opens the delete dialog and clicks the Delete button
- **THEN** the `tasks.delete` RPC is called with the task id

### Requirement: Session sidebar edge cases are covered by Playwright tests
The test suite SHALL verify session auto-title format, blur-triggered rename commit, and session re-ordering when `lastActivityAt` changes via a WebSocket push.

#### Scenario: Newly created session title matches Chat – Month Day format
- **WHEN** a session is created with the auto-generated title
- **THEN** the title shown in the sidebar matches the pattern "Chat – {Month} {Day}" (e.g. "Chat – Apr 21")

#### Scenario: Clicking away from title input commits the rename
- **WHEN** the user edits the session title inline and tabs or clicks away
- **THEN** the `chatSessions.rename` RPC is called with the new title without requiring an Enter key press

#### Scenario: Session moves to top of list after WS activity push
- **WHEN** the server pushes a `chat_session_updated` event for a non-top session with a newer `lastActivityAt`
- **THEN** that session appears first in the sidebar list

### Requirement: Attachment chips in conversation history are covered by Playwright tests
The test suite SHALL verify that persisted messages with file chip syntax (`[#ref|label]`) in their content render visible `.inline-chip-text__chip--file` chips inside the conversation history bubble.

> **Implementation note**: `metadata.attachments` is engine-only binary data; UI chips come from `[#ref|label]` syntax parsed by `segmentChipText()`.

#### Scenario: Sent message with file chip syntax shows chip in history
- **WHEN** the conversation loads a user message whose content contains `[#ref|label]` chip syntax
- **THEN** an `.inline-chip-text__chip--file` chip is visible within the rendered message bubble

### Requirement: Stream state isolation is covered by Playwright tests
The test suite SHALL verify that concurrent conversations maintain independent stream state and that switching between chat surfaces does not corrupt or share stream state.

#### Scenario: Task A stream content does not appear in task B's conversation
- **WHEN** task A is streaming and the user opens task B's drawer
- **THEN** task B's conversation body does not contain task A's streamed content

#### Scenario: Stream state survives switching from task to session drawer and back
- **WHEN** a task conversation is streaming and the user opens a session drawer then switches back to the task
- **THEN** the task's streamed content is still visible in the task drawer

### Requirement: Legacy prompt row and transition card coexist in the timeline
The test suite SHALL verify that a conversation timeline containing both a legacy prompt row (type "user", role "prompt") and a modern transition_event card renders both correctly without crash or duplication.

#### Scenario: Both legacy and modern transition rows render in the same timeline
- **WHEN** the conversation history contains a message with type "user" and role "prompt" followed by a message with type "transition_event"
- **THEN** both the `.msg--prompt` element and the transition card element are visible in the conversation body
