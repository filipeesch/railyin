## MODIFIED Requirements

### Requirement: Typing `/` in the chat editor triggers a slash command picker
The system SHALL open an autocomplete dropdown when the user types `/` at any position in the chat editor. The dropdown SHALL list all slash commands discoverable from the active engine for the current task. The list SHALL update as the user continues typing (fuzzy/substring match on command name). Command data SHALL be served from the `useCommandsCache` composable, which returns cached data immediately and triggers a background refresh — the picker SHALL never block on a network call after the first open.

#### Scenario: Dropdown opens on `/`
- **WHEN** the user types `/` in the chat editor
- **THEN** an autocomplete dropdown appears showing all available commands with their names and descriptions

#### Scenario: List filters as user types
- **WHEN** the user types `/pro` after opening the picker
- **THEN** the dropdown narrows to commands whose names contain or fuzzy-match `pro`

#### Scenario: Selecting a command inserts a chip
- **WHEN** the user clicks or keyboard-selects a command from the dropdown
- **THEN** the `/query` text is replaced by an atomic chip token for that command, and the dropdown closes

#### Scenario: Empty list shown gracefully when no commands exist
- **WHEN** the engine has no discoverable commands
- **THEN** the dropdown shows an empty state message (e.g. "No commands found") rather than staying open with nothing

#### Scenario: Escape dismisses the dropdown
- **WHEN** the dropdown is open and the user presses Escape
- **THEN** the dropdown closes and the typed text is preserved as-is

#### Scenario: Picker responds instantly on repeat open
- **WHEN** the user types `/` for the second or later time for the same task
- **THEN** the dropdown appears immediately (no perceptible delay) using cached command data
