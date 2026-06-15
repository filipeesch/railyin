## Purpose
Defines standalone workspace chat sessions and their sidebar lifecycle.

## Requirements

### Requirement: Workspace-level chat sessions
The system SHALL support standalone AI chat sessions that are not associated with any task. Sessions SHALL exist at workspace scope and persist across application restarts. **When the user switches to a different workspace, the session list MUST be reloaded from the backend to display only sessions belonging to the newly active workspace.**

#### Scenario: Chat session persists after restart
- **WHEN** the user creates a chat session and closes the app
- **THEN** the session appears in the sidebar when the app is reopened

#### Scenario: Session not tied to a task
- **WHEN** a chat session is created from the sidebar
- **THEN** no task is created and the session does not appear on the board

#### Scenario: Session list reflects current workspace after switch
- **WHEN** the user clicks a workspace tab to switch workspaces
- **THEN** the sidebar displays only sessions scoped to the selected workspace (sessions from other workspaces are no longer visible)

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
The system SHALL display sessions in the sidebar sorted by `last_activity_at` descending (most recently active first). **After reloading on workspace switch, the list MUST be re-sorted by the new workspace's sessions.**

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

### Requirement: Pi engine chat sessions require context window configuration
When the selected model uses the Pi engine, the system SHALL resolve `contextWindowOverride` from Model Settings before starting the chat execution. If no context window is configured for the selected model, the system SHALL persist a system error message in the conversation and halt execution without creating a managed AI execution.

#### Scenario: Pi model with context window configured produces a response
- **WHEN** the user sends a message in a chat session with a Pi model that has a context window configured
- **THEN** the system resolves the context window, starts the execution, and produces an AI response

#### Scenario: Pi model without context window configured shows error
- **WHEN** the user sends a message in a chat session with a Pi model that has no context window configured in Model Settings
- **THEN** the system persists a system error message in the conversation (e.g. "Pi requires a context window configured for model '…'. Go to Model Settings to configure it.") and the session returns to idle without calling the Pi engine

### Requirement: Board tools available in chat sessions
The system SHALL make board management tools (`get_task`, `list_tasks`, `create_task`, `move_task`, `message_task`, `edit_task`, `delete_task`, `get_board_summary`) available to the AI in chat sessions, consistent with task execution contexts.

#### Scenario: Board tools reachable from chat
- **WHEN** the AI in a chat session calls a board tool (e.g. `get_task`)
- **THEN** the tool executes and the result is returned to the AI as a tool result message

### Requirement: Session list reloads on workspace switch
The system SHALL reload the chat session list whenever the active workspace changes, ensuring only sessions belonging to the newly selected workspace are shown.

#### Scenario: Switching workspace refreshes session list
- **WHEN** the user selects a different workspace
- **THEN** the chat sidebar shows only sessions belonging to that workspace

#### Scenario: Sessions from previous workspace are removed
- **WHEN** the user switches from workspace A to workspace B
- **THEN** sessions from workspace A no longer appear in the sidebar

### Requirement: WS push events filtered by active workspace
The system SHALL ignore incoming `chatSession.updated` push events whose `workspaceKey` does not match the currently active workspace, preventing sessions from other workspaces appearing in the sidebar.

#### Scenario: Push event for wrong workspace is ignored
- **WHEN** a `chatSession.updated` event arrives for workspace B while workspace A is active
- **THEN** the session does not appear in workspace A's sidebar

#### Scenario: Push event for active workspace is applied
- **WHEN** a `chatSession.updated` event arrives for the active workspace
- **THEN** the session is added or updated in the sidebar

### Requirement: Session list re-syncs after WebSocket reconnect
The system SHALL re-fetch the full session list from the server after a WebSocket reconnect to recover sessions created or updated while the connection was down.

#### Scenario: Sessions created while disconnected appear after reconnect
- **WHEN** the WebSocket drops and reconnects
- **THEN** sessions created during the disconnection period appear in the sidebar

### Requirement: Toolbar button shows non-archived session count badge
The system SHALL display a count badge on the chat sidebar toggle button reflecting the number of non-archived sessions for the active workspace. The badge SHALL be hidden when the count is zero.

#### Scenario: Badge shows session count
- **WHEN** there are non-archived chat sessions for the active workspace
- **THEN** the chat toggle button displays the count

#### Scenario: Badge hidden when no sessions exist
- **WHEN** there are no non-archived sessions
- **THEN** no badge is shown on the chat toggle button

### Requirement: Chat session exposes shell auto-approve state
The `ChatSession` type SHALL include `shellAutoApprove: boolean` and `approvedCommands: string[]` fields, mapped from the `chat_sessions` DB columns.

#### Scenario: ChatSession RPC response includes shellAutoApprove
- **WHEN** any RPC endpoint returns a `ChatSession` object
- **THEN** the object includes `shellAutoApprove` reflecting the current DB value

#### Scenario: ChatSession RPC response includes approvedCommands
- **WHEN** any RPC endpoint returns a `ChatSession` object
- **THEN** the object includes `approvedCommands` as a parsed string array

### Requirement: Chat session drawer shows shell auto-approve toggle
The chat session drawer SHALL display a shell auto-approve toggle in the conversation input bar. The toggle SHALL be visually and functionally identical to the task chat toggle. When toggled, the frontend SHALL call `chatSessions.setShellAutoApprove`.

#### Scenario: Toggle visible when chat session is open
- **WHEN** the user opens a chat session drawer
- **THEN** a shell auto-approve toggle is visible in the input bar footer

#### Scenario: Toggle reflects current session state on open
- **WHEN** a chat session with `shellAutoApprove: true` is opened
- **THEN** the toggle is shown in the ON position
