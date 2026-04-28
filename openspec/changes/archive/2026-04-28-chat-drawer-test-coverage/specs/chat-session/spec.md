## ADDED Requirements

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
