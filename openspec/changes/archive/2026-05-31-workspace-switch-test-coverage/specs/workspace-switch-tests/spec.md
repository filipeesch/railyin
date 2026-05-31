## ADDED Requirements

### Requirement: Rapid workspace switching converges to correct final state
When the user rapidly clicks multiple workspace tabs in succession (faster than individual API responses complete), the UI SHALL eventually display the correct boards, chat sessions, and configuration for the LAST-clicked workspace. Transient displays of intermediate workspace data are acceptable but MUST self-correct.

#### Scenario: Three rapid switches converge to third workspace
- **WHEN** the user clicks workspace tab A, then B, then C within 500ms total
- **THEN** after all pending requests resolve, the sidebar shows only workspace C's sessions and the main view shows workspace C's boards

#### Scenario: Rapid switch leaves no stale session items visible
- **WHEN** the user rapidly switches between workspaces
- **THEN** at no point do sessions from two different workspaces appear simultaneously in the sidebar

### Requirement: Revisiting a previously active workspace restores its exact state
When the user switches from workspace A → B → A, the second visit to workspace A SHALL display the same sessions and boards as were visible during the first visit (modulo any changes that occurred on the server during the absence).

#### Scenario: Session list restored after round-trip
- **WHEN** workspace A has sessions [S1, S2], user switches to workspace B, then back to A
- **THEN** workspace A's sidebar again shows exactly sessions [S1, S2] (sorted by lastActivityAt)

#### Scenario: Active board restored after round-trip
- **WHEN** workspace A has boards [B1, B2] with B1 active, user switches to workspace B, then back to A
- **THEN** workspace A's view again shows board B1 as selected and active

#### Scenario: Board creation during absence appears on revisit
- **WHEN** a new board B3 is created in workspace A while the user is viewing workspace B
- **THEN** upon returning to workspace A, board B3 appears in the board list

### Requirement: Workspace creation triggers full downstream initialization
When the user creates a new workspace via the Setup flow or admin panel, selecting that newly created workspace SHALL trigger reloads of ALL dependent data: workspace config, board list, chat sessions, and enabled models.

#### Scenario: New workspace selection loads fresh board list
- **WHEN** the user creates "New WS" which initially has zero boards
- **THEN** after `selectWorkspace("new-ws")`, `boards.list` is called and `activeBoardId` reflects the new workspace state

#### Scenario: New workspace selection loads fresh session list
- **WHEN** the user creates "New WS" which initially has zero sessions
- **THEN** after `selectWorkspace("new-ws")`, `chatSessions.list` is called and the sidebar shows an empty list

#### Scenario: New workspace selection loads fresh model list
- **WHEN** the user creates "New WS" with a specific default model
- **THEN** after `selectWorkspace("new-ws")`, `models.listEnabled` is called with the new workspace key

### Requirement: WebSocket reconnect during active execution restores session state
When the WebSocket connection drops and reconnects while a chat session execution is running, the session list SHALL re-fetch from the server to ensure no sessions are lost or duplicated.

#### Scenario: Running session survives WS reconnect
- **WHEN** a chat session has status "running" and the WebSocket disconnects + reconnects
- **THEN** the session list shows the session with status "running" (not reverted to "idle")

#### Scenario: Completed session reflected after reconnect
- **WHEN** a chat session completes (status "idle") while disconnected, then the WS reconnects
- **THEN** the session list shows the session with updated status "idle" and current `lastActivityAt`

#### Scenario: No duplicate sessions after reconnect
- **WHEN** the WS reconnects and `chatSessions.list` returns a list of N sessions
- **THEN** `chatStore.sessions` contains exactly N entries (no duplicates from merge or append)
