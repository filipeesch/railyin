## Purpose
Defines standalone workspace chat sessions and their sidebar lifecycle.

## Requirements

### Requirement: Workspace-level chat sessions
The system SHALL support standalone AI chat sessions that are not associated with any task. Sessions SHALL exist at workspace scope and persist across application restarts.

#### Scenario: Chat session persists after restart
- **WHEN** the user creates a chat session and closes the app
- **THEN** the session appears in the sidebar when the app is reopened

#### Scenario: Session not tied to a task
- **WHEN** a chat session is created from the sidebar
- **THEN** no task is created and the session does not appear on the board

### Requirement: Session creation
The system SHALL allow the user to create a new chat session from the sidebar via a "New Chat" button. The system SHALL auto-generate a session title based on the creation timestamp (format: "Chat – Mon DD").

#### Scenario: New chat button creates session
- **WHEN** the user clicks the "New Chat" button in the chat sidebar
- **THEN** a new session is created and immediately opened in the detail panel

#### Scenario: Auto-generated title
- **WHEN** a session is created without a user-provided title
- **THEN** the session title defaults to "Chat – {Month} {Day}" (e.g., "Chat – Apr 21")

### Requirement: Session renaming
The system SHALL allow the user to rename a session via a pencil icon button visible on hover in the sidebar item and in the detail panel header. Renaming SHALL be inline (no modal).

#### Scenario: Rename via pencil icon
- **WHEN** the user clicks the pencil icon next to a session title
- **THEN** the title becomes an editable inline text field

#### Scenario: Rename saved on Enter or blur
- **WHEN** the user types a new name and presses Enter or clicks away
- **THEN** the new title is persisted and shown in both the sidebar and detail panel

### Requirement: Session list sorted by recent activity
The system SHALL display sessions in the sidebar sorted by `last_activity_at` descending (most recently active first).

#### Scenario: Recent session appears at top
- **WHEN** a session receives a new AI response
- **THEN** it moves to the top of the sidebar list

### Requirement: Session status indicators
The system SHALL display a flat, colored status icon on each session sidebar item reflecting the current session state:
- **Running**: blue pulsing dot
- **Waiting**: amber dot (needs user input — ask_user, interview_me, or shell approval)
- **Unread**: red dot (`last_activity_at > last_read_at` and session is not open)
- **Idle**: no indicator (default state)
- **Archived**: greyed out icon

#### Scenario: Running indicator during execution
- **WHEN** an AI execution is active for a session
- **THEN** the session item shows a blue running indicator

#### Scenario: Waiting indicator on user attention required
- **WHEN** the execution transitions to `waiting_user` state
- **THEN** the session item shows an amber waiting indicator

#### Scenario: Unread indicator on new activity
- **WHEN** a session's `last_activity_at` is newer than `last_read_at` and the session panel is closed
- **THEN** the session item shows a red unread indicator

#### Scenario: Unread cleared on session open
- **WHEN** the user opens a session panel
- **THEN** the system calls `chatSessions.markRead` and the unread indicator disappears

### Requirement: Session archiving
The system SHALL allow the user to manually archive a session via a context menu or archive button. The system SHALL automatically archive sessions with no activity for 7 or more days. Archived sessions SHALL be hidden from the default sidebar view but accessible via a "Show archived" toggle.

#### Scenario: Manual archive
- **WHEN** the user selects "Archive" from the session context menu
- **THEN** the session status becomes `archived` and it is removed from the default sidebar view

#### Scenario: Auto-archive after inactivity
- **WHEN** a session's `last_activity_at` is more than 7 days ago
- **THEN** the system sets `status = 'archived'` via background job

#### Scenario: Archived sessions visible via toggle
- **WHEN** the user enables "Show archived" in the sidebar
- **THEN** archived sessions appear at the bottom of the list, visually distinct (greyed out)

### Requirement: Mark session as read
The system SHALL update `last_read_at` to the current timestamp when the user opens a session panel.

#### Scenario: Read state updated on panel open
- **WHEN** the user clicks a session in the sidebar
- **THEN** `chatSessions.markRead({ sessionId })` is called and `last_read_at` is updated to now

### Requirement: Session auto-title format is verifiable via mock
The system SHALL produce a session title matching "Chat – {Month} {Day}" (e.g. "Chat – Apr 21") when `chatSessions.create` is called without an explicit title, so that the format can be asserted in E2E tests by matching against the mock-returned title.

#### Scenario: Created session title in sidebar matches Chat – Month Day
- **WHEN** a new session is created and `chatSessions.list` returns a session with title "Chat – Apr 21"
- **THEN** the session item in the sidebar displays exactly "Chat – Apr 21"

### Requirement: Session rename is committed on blur as well as Enter
The system SHALL call `chatSessions.rename` when the inline title input loses focus (blur), not only on Enter key press, so that mouse-based navigation (clicking elsewhere) also persists the rename.

#### Scenario: Blur commits rename without pressing Enter
- **WHEN** the user edits the session title inline and clicks outside the input field
- **THEN** `chatSessions.rename` is called with the new title

### Requirement: Sidebar session list re-orders reactively on activity push
The system SHALL re-sort the session list whenever a `chat_session_updated` WebSocket event arrives with a newer `lastActivityAt`, placing the updated session at the top of the list.

#### Scenario: Session moves to first position after WS push
- **WHEN** two sessions are listed (session B above session A) and a WS push updates session A's `lastActivityAt` to a timestamp newer than session B's
- **THEN** session A appears first in the sidebar list above session B
