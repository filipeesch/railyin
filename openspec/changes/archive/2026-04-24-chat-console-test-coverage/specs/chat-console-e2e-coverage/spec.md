## ADDED Requirements

### Requirement: Broken selectors are corrected
The test suite SHALL use `button[aria-label='New chat session']` to target the new-session button in `ChatSidebar.vue`, not `.chat-sidebar__new-btn` which matches no element.

#### Scenario: New chat session button is clickable via aria-label selector
- **WHEN** the chat sidebar is open
- **THEN** `button[aria-label='New chat session']` resolves to exactly one visible element

---

### Requirement: Sidebar auto-opens when a session becomes active
The sidebar SHALL open automatically when `chatStore.activeChatSessionId` becomes non-null, even if the user did not manually toggle it.

#### Scenario: Session activated via WS push opens sidebar
- **WHEN** a `chatSession.updated` WS event arrives and the user clicks on a session
- **THEN** the sidebar becomes visible without the user clicking the toolbar toggle

---

### Requirement: Active session is highlighted in sidebar
The currently open session SHALL have the `is-active` CSS class applied to its `.session-item` element.

#### Scenario: Opened session item has is-active class
- **WHEN** a session is opened via `chatStore.selectSession`
- **THEN** its `.session-item` element has class `is-active`
- **THEN** other session items do not have class `is-active`

---

### Requirement: Archived sessions are hidden from sidebar list
Sessions with `status: 'archived'` SHALL NOT appear in the active sessions list.

#### Scenario: Archived session not shown in sidebar
- **WHEN** a session with `status: 'archived'` exists in the store
- **THEN** no `.session-item` for that session is visible in the sidebar

---

### Requirement: Sidebar width persists across page reload
The sidebar width SHALL be saved to `localStorage` key `chat-sidebar-width` and restored on reload.

#### Scenario: Custom width is restored after reload
- **WHEN** the user sets a custom sidebar width
- **THEN** `localStorage.getItem('chat-sidebar-width')` reflects the custom width
- **WHEN** the page is reloaded
- **THEN** the sidebar renders at the same custom width

---

### Requirement: Sidebar drag-resize handle changes width
Dragging the `.chat-sidebar__resize-handle` left/right SHALL change the sidebar width within min (160px) / max (400px) bounds.

#### Scenario: Drag left increases sidebar width
- **WHEN** the user drags the resize handle to the left
- **THEN** the sidebar becomes wider
- **THEN** `localStorage.getItem('chat-sidebar-width')` is updated

#### Scenario: Width is clamped at min and max
- **WHEN** the user drags the resize handle beyond the max bound
- **THEN** the sidebar width is capped at 400px
- **WHEN** the user drags beyond the min bound
- **THEN** the sidebar width is floored at 160px

---

### Requirement: markRead is called when a session is opened
The system SHALL call `chatSessions.markRead` when a user opens a session.

#### Scenario: markRead API called on selectSession
- **WHEN** the user clicks a session in the sidebar
- **THEN** a `chatSessions.markRead` API request is made for that session

---

### Requirement: Unread dot disappears after opening a session
The unread indicator SHALL be removed from a session item once the user opens that session.

#### Scenario: Unread dot cleared after opening
- **WHEN** a session has an unread dot (visible `.session-item__unread-dot`)
- **WHEN** the user clicks that session
- **THEN** the `.session-item__unread-dot` for that session is no longer visible

---

### Requirement: Unread is not marked for the currently active session
A WS `chatSession.updated` event with `lastReadAt: null` SHALL NOT mark a session as unread if it is the currently active (open) session.

#### Scenario: Active session does not get unread dot
- **WHEN** a session is currently open (active)
- **WHEN** a `chatSession.updated` WS event arrives for that session with `lastReadAt: null`
- **THEN** no unread dot appears for that session

---

### Requirement: Sessions are loaded from API on page boot
The system SHALL call `chatSessions.list` on page load and display sessions in the sidebar without requiring a WS push.

#### Scenario: Sessions appear in sidebar after initial page load
- **WHEN** the page loads and `chatSessions.list` returns sessions
- **THEN** those sessions are visible in the sidebar without any WS event

---

### Requirement: Models are loaded on page boot
The system SHALL call `models.listEnabled` on page load and populate the model selector in session mode.

#### Scenario: Model dropdown shows options after boot
- **WHEN** the page loads and `models.listEnabled` returns models
- **WHEN** the user opens a session drawer
- **THEN** the model dropdown contains at least one option

---

### Requirement: Drawer closes on outside click
Clicking outside the `ConversationDrawer` panel SHALL close the drawer.

#### Scenario: Click on board backdrop closes drawer
- **WHEN** the drawer is open
- **WHEN** the user clicks on the board backdrop (outside the drawer panel)
- **THEN** the drawer closes

---

### Requirement: Loading spinner shown while messages load
The system SHALL display a loading indicator while `chatStore.messagesLoading` is true.

#### Scenario: Spinner visible during message fetch
- **WHEN** a session is being opened and messages are loading
- **THEN** a loading element (`.scv-loading`) is visible
- **WHEN** messages finish loading
- **THEN** the loading element is replaced by the message list

---

### Requirement: Closing drawer clears active session
Closing the drawer SHALL set `chatStore.activeChatSessionId` to null, removing the active highlight from all session items.

#### Scenario: Closing drawer deactivates session
- **WHEN** a session is open (has active highlight in sidebar)
- **WHEN** the close button is clicked
- **THEN** no session item has the `is-active` class

---

### Requirement: Empty rename does not call the rename API
Saving a blank rename input SHALL cancel the rename without calling `chatSessions.rename`.

#### Scenario: Blank rename input cancels without API call
- **WHEN** the user opens the rename input for a session
- **WHEN** the user clears the input and presses Enter
- **THEN** no `chatSessions.rename` API request is made
- **THEN** the original session title is still displayed

---

### Requirement: WS dedup prevents duplicate session items
Receiving a `chatSession.updated` event for an existing session SHALL update the item in place, not add a duplicate.

#### Scenario: Updated WS event for existing session does not duplicate
- **WHEN** the sidebar shows one session
- **WHEN** a `chatSession.updated` event arrives for that same session
- **THEN** exactly one session item exists for that session

---

### Requirement: Creating a session while another is open replaces drawer content
Calling `createSession` when a session drawer is already open SHALL close the current session and open the new one.

#### Scenario: New session replaces active session in drawer
- **WHEN** session A is open in the drawer
- **WHEN** the user creates a new session (e.g. clicks "+ New chat")
- **THEN** the drawer now shows the new session
- **THEN** session A's content is no longer visible in the drawer
