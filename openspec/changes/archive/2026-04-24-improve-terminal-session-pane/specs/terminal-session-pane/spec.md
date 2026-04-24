## ADDED Requirements

### Requirement: Terminal session list width is user-resizable
The system SHALL provide a draggable vertical divider between terminal output and the terminal session list so users can resize the session list width without changing terminal panel height.

#### Scenario: User drags the terminal session divider wider
- **WHEN** the terminal panel is open and the user drags the session divider horizontally
- **THEN** the session list width updates in real time while the terminal output area shrinks accordingly

#### Scenario: Session list width is clamped to safe bounds
- **WHEN** the user drags the divider beyond the supported minimum or maximum
- **THEN** the session list width remains clamped between 160px and 400px

### Requirement: Terminal session pane width persists per browser profile
The system SHALL persist the terminal session list width in browser-local UI state so the chosen width is restored after reload for the same browser profile.

#### Scenario: Reload restores the previous session list width
- **WHEN** a user resizes the terminal session list and reloads the application
- **THEN** the terminal panel restores the previously saved session list width for that browser profile

### Requirement: Terminal session list overflow remains visible and scrollable
The system SHALL preserve native vertical scrolling for terminal sessions and style the native scrollbar so overflow is visually discoverable in the terminal panel theme.

#### Scenario: Overflowing session list shows a visible scrollbar treatment
- **WHEN** the number of terminal sessions exceeds the visible height of the session list
- **THEN** the session list remains scrollable with a visible themed native scrollbar

#### Scenario: Session creation control remains accessible with overflow
- **WHEN** the terminal session list overflows
- **THEN** users can still scroll to hidden sessions and access the new terminal control without losing the ability to switch sessions
