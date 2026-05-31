## MODIFIED Requirements

### Requirement: Workspace-level chat sessions
The system SHALL support standalone AI chat sessions that are not associated with any task. Sessions SHALL exist at workspace scope — each workspace maintains its own independent set of chat sessions. When the user switches workspaces, the system SHALL reload the session list for the new workspace and display only sessions belonging to that workspace. Archived sessions from other workspaces MUST NOT appear in the default view.

#### Scenario: Chat session persists after restart
- **WHEN** the user creates a chat session and closes the app
- **THEN** the session appears in the sidebar when the app is reopened

#### Scenario: Session not tied to a task
- **WHEN** a chat session is created from the sidebar
- **THEN** no task is created and the session does not appear on the board

#### Scenario: Switching workspaces reloads session list
- **WHEN** the user clicks a different workspace tab
- **THEN** the system fetches only sessions for the newly selected workspace and clears sessions from the previous workspace

#### Scenario: Active session closed on workspace switch
- **WHEN** the user switches workspaces while an active session is open
- **THEN** the active session is closed (drawer closes, `activeChatSessionId` resets) so the user cannot interact with a session from another workspace

#### Scenario: Sessions from another workspace are hidden
- **WHEN** workspace A has sessions and the user switches to workspace B
- **THEN** only workspace B's sessions appear; workspace A's sessions do NOT leak into the sidebar or drawer

## ADDED Requirements

### Requirement: Chat session list reloaded on workspace change
The system SHALL call `chatSessions.list` with the new workspace key whenever the active workspace changes, ensuring the sidebar reflects the correct workspace's sessions.

#### Scenario: Load triggered by workspace switch via BoardView
- **WHEN** the user clicks a workspace tab in the board header
- **THEN** the system calls `chatSessions.list` with the target workspace key as a parameter

#### Scenario: Load triggered by workspace switch via SetupView
- **WHEN** the user selects a workspace during setup flow
- **THEN** the system calls `chatSessions.list` with the target workspace key as a parameter
