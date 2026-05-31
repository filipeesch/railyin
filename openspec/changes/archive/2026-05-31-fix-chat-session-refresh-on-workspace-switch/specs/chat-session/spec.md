## MODIFIED Requirements

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

### Requirement: Session list sorted by recent activity
The system SHALL display sessions in the sidebar sorted by `last_activity_at` descending (most recently active first). **After reloading on workspace switch, the list MUST be re-sorted by the new workspace's sessions.**

#### Scenario: Recent session appears at top
- **WHEN** a session receives a new AI response
- **THEN** it moves to the top of the sidebar list
