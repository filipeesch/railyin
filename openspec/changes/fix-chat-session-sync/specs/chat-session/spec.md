## ADDED Requirements

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

## REMOVED Requirements

### Requirement: chatSession.created event
**Reason**: The backend only emits `chatSession.updated` for all session lifecycle events, including creation. The `chatSession.created` event type was dead code — it was declared in `rpc-types.ts` and wired in `App.vue`/`rpc.ts` but never broadcast by the backend.
**Migration**: Remove `chatSession.created` from `rpc-types.ts` push event union, remove the `onChatSessionCreated` export from `rpc.ts`, and remove the `onChatSessionCreated` registration from `App.vue`.
