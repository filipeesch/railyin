## ADDED Requirements

### Requirement: SessionChatView includes a Notes tab
The system SHALL add a **Notes** tab to `SessionChatView.vue` alongside the existing Chat and Decisions tabs. The tab SHALL render `NotesPanel.vue` when active, passing `session.conversationId` as the `conversationId` prop.

#### Scenario: Notes tab is visible in session chat
- **WHEN** a chat session is open in the detail panel
- **THEN** a "Notes" tab button is visible in the tab switcher after the Decisions tab

#### Scenario: Notes panel renders when Notes tab is selected
- **WHEN** the user clicks the Notes tab in `SessionChatView.vue`
- **THEN** `NotesPanel.vue` is rendered with the session's `conversationId`

#### Scenario: Notes panel shows notes created by AI during execution
- **WHEN** an AI execution creates notes via `create_note` tool
- **THEN** the Notes tab displays those notes when the session returns to idle

### Requirement: Notes panel refreshes after session execution completes
The system SHALL re-fetch notes in the Notes panel when a chat session execution completes (status transitions from `running` to `idle` or `waiting_user`).

#### Scenario: Notes refresh after execution
- **WHEN** a chat session's status changes from `running` to `idle`
- **THEN** the Notes panel re-fetches notes from `notes.list` RPC

#### Scenario: Notes refresh trigger increments on status change
- **WHEN** session status changes from `running` to non-running
- **THEN** `notesRefreshTrigger` ref is incremented to trigger the NotesPanel re-fetch

### Requirement: Notes panel in SessionChatView reuses NotesPanel component
The system SHALL reuse the existing `NotesPanel.vue` component without modification. The component already accepts `conversationId` and `refreshTrigger` props and works for any conversation.

#### Scenario: NotesPanel props are passed correctly
- **WHEN** the Notes tab is active in SessionChatView
- **THEN** `NotesPanel` receives `conversationId` set to `session.conversationId` and `refreshTrigger` set to the local trigger ref

#### Scenario: Notes panel is hidden when Notes tab is not active
- **WHEN** the user selects Chat or Decisions tab
- **THEN** `NotesPanel.vue` is not rendered (same v-if pattern as DecisionsPanel)

### Requirement: Playwright tests cover Notes tab in session context
The system SHALL include Playwright tests in `e2e/ui/session-chat-notes.spec.ts` verifying the Notes tab in session context. Tests SHALL follow the existing `notes.spec.ts` pattern with mocked API and WS events.

#### Scenario: CSN-1 — Notes tab button is visible in session chat view
- **WHEN** a chat session is open in the detail panel
- **THEN** a "Notes" tab button (`.scv-tab-btn` with text "Notes") is visible

#### Scenario: CSN-2 — Notes panel renders with session conversationId
- **WHEN** the user clicks the Notes tab in session chat
- **THEN** `notes.list` is called with the session's `conversationId`

#### Scenario: CSN-3 — Notes panel shows notes after AI execution creates them
- **WHEN** a session execution completes and `notes.list` returns notes
- **THEN** note items (`.note-item`) are visible in the Notes panel

#### Scenario: CSN-4 — Notes panel refreshes on status change (running → idle)
- **WHEN** a session status changes from `running` to `idle` via WS push
- **THEN** `notes.list` is called again to re-fetch notes

### Requirement: Session fixture added to Playwright test infrastructure
The system SHALL add a `session: ChatSession` fixture to `e2e/ui/fixtures/index.ts` mirroring the existing `task` fixture pattern. The fixture SHALL provide a default session object that tests can override.

#### Scenario: Session fixture provides default ChatSession
- **WHEN** a test uses the `session` fixture
- **THEN** it receives a `ChatSession` object with default values (id, title, conversationId, status: "idle")

#### Scenario: Tests can override session fixture values
- **WHEN** a test needs a specific session configuration
- **THEN** it can override the fixture with `makeChatSession({ ... })`
