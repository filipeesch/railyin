## Purpose
Defines the in-app terminal panel rendered at the bottom of BoardView, including its toggle behavior, layout, resize handle, session list sidebar, and footer strip. The xterm.js rendering component (`PtyTerminal.vue`) already exists and connects to the backend via WebSocket at `/ws/pty/{sessionId}`.

## ADDED Requirements

### Requirement: A footer strip is always visible at the bottom of BoardView
The BoardView SHALL render a slim footer strip (≤24px height) pinned between the board columns and the window bottom at all times. The strip SHALL act as the primary toggle for the terminal panel and SHALL display running session status when sessions are active.

#### Scenario: No active sessions
- **WHEN** no terminal sessions exist or none are running
- **THEN** the footer strip shows "Terminal" label and a keyboard shortcut hint (`Ctrl+\``)

#### Scenario: Sessions are running
- **WHEN** one or more sessions have a running process
- **THEN** the footer strip shows a green indicator dot, session count, and the name + status of the most recently active session

#### Scenario: Footer strip clicked
- **WHEN** the user clicks anywhere on the footer strip
- **THEN** the terminal panel toggles open (if closed) or closed (if open)

### Requirement: The terminal panel occupies the bottom portion of BoardView when open
When open, the terminal panel SHALL be rendered below the board columns, occupying approximately 30–40% of the available window height by default. The board columns SHALL resize to fill the remaining space above.

#### Scenario: Terminal panel opens
- **WHEN** the terminal panel is toggled open
- **THEN** the board columns shrink to accommodate the panel; the panel appears with its last used height or the default height if never opened

#### Scenario: Terminal panel closes
- **WHEN** the terminal panel is toggled closed
- **THEN** the board columns expand to fill the full height; the panel is hidden (not destroyed)

### Requirement: The terminal panel height is user-adjustable via a drag handle
The terminal panel SHALL have a drag handle at its top edge that allows the user to resize the panel height. A minimum height of 120px SHALL be enforced. The panel cannot be fully closed by dragging — only the footer strip or keyboard shortcut can fully close it.

#### Scenario: User drags handle upward
- **WHEN** the user drags the resize handle upward
- **THEN** the terminal panel grows and the board columns shrink proportionally

#### Scenario: User drags handle below minimum height
- **WHEN** the user drags the resize handle below the minimum height
- **THEN** the panel height is clamped to the minimum (120px) and does not close

### Requirement: Ctrl+` toggles the terminal panel
The system SHALL register `Ctrl+\`` as a global keyboard shortcut within the BoardView. Pressing it SHALL toggle the terminal panel open or closed.

#### Scenario: Keyboard shortcut while panel is closed
- **WHEN** the user presses `Ctrl+\`` and the panel is closed
- **THEN** the terminal panel opens and focuses the active session

#### Scenario: Keyboard shortcut while panel is open
- **WHEN** the user presses `Ctrl+\`` and the panel is open
- **THEN** the terminal panel closes

### Requirement: The session list sidebar is on the right side of the terminal panel
The terminal panel SHALL render a fixed-width sidebar on the right side listing all open terminal sessions. The left portion SHALL render the active session's xterm.js terminal.

#### Scenario: Session list shows all sessions
- **WHEN** the terminal panel is open
- **THEN** the sidebar shows one entry per session with: session name, truncated cwd, and last command or status indicator

#### Scenario: Active session is highlighted
- **WHEN** a session is selected as active
- **THEN** its sidebar entry is visually highlighted and its output is shown in the left panel

#### Scenario: User clicks a session in the list
- **WHEN** the user clicks a session entry in the sidebar
- **THEN** that session becomes active and its terminal output is displayed

#### Scenario: New terminal button
- **WHEN** the user clicks the "⊕ New terminal" button at the bottom of the session list
- **THEN** a new unlinked session is created at workspace root and becomes active
