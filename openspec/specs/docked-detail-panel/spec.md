## Purpose
Defines the shared docked right-side detail panel that hosts task and session detail views.

## Requirements

### Requirement: Docked detail panel replaces overlay drawer
The system SHALL display task and session detail as a docked flex panel on the right side of the board, replacing the PrimeVue floating overlay Drawer. Opening the panel SHALL compress the board columns horizontally. The panel SHALL animate open/close with a slide transition.

#### Scenario: Board compresses when panel opens
- **WHEN** the user clicks a task card or a session in the sidebar
- **THEN** the detail panel slides in from the right and the board center compresses to accommodate it

#### Scenario: Panel closes and board re-expands
- **WHEN** the user closes the panel (Escape key or close button)
- **THEN** the panel slides out and the board center re-expands to full width

### Requirement: Single panel slot for task and session
The system SHALL use a single detail panel slot that renders either a task view or a session view depending on the active selection. Only one view SHALL be visible at a time.

#### Scenario: Switching from task to session
- **WHEN** the user clicks a session in the sidebar while a task detail is open
- **THEN** the panel content switches to the session view without closing and reopening

#### Scenario: Switching from session to task
- **WHEN** the user clicks a task card while a session panel is open
- **THEN** the panel content switches to the task view

### Requirement: Panel width persistence
The system SHALL persist the user's preferred panel width across sessions (same pattern as terminal panel height).

#### Scenario: Panel width restored on reload
- **WHEN** the user resizes the detail panel and reloads the app
- **THEN** the panel opens at the previously set width

### Requirement: Layout structure
The board view layout SHALL be a horizontal flex row: `[chat-sidebar (220px)] [board-center (flex: 1)] [detail-panel (N px, collapsible)]`. The chat sidebar SHALL always be visible when there is at least one chat session.

#### Scenario: Initial layout with no sessions
- **WHEN** the app loads with no chat sessions
- **THEN** the sidebar shows an empty state with a "New Chat" prompt

#### Scenario: Initial layout with sessions
- **WHEN** the app loads with existing chat sessions
- **THEN** the sidebar is visible showing the session list
