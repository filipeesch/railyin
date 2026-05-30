## ADDED Requirements

### Requirement: Active workspace selection persists across page reloads
The system SHALL save the active workspace key to `localStorage` under key `railyn.activeWorkspaceKey` whenever the active workspace changes. On startup, the system SHALL restore the saved workspace if it still exists in the list of available workspaces, falling back to the first available workspace otherwise.

#### Scenario: Saved workspace restored on reload
- **WHEN** the user has previously selected a workspace and reloads the page
- **THEN** the same workspace is active after reload without any user action

#### Scenario: Fallback when saved workspace no longer exists
- **WHEN** the persisted workspace key is not present in the loaded workspace list (e.g. deleted)
- **THEN** the system falls back to the first available workspace

#### Scenario: No entry yet — defaults to first workspace
- **WHEN** no `railyn.activeWorkspaceKey` key exists in localStorage
- **THEN** the system behaves as before and selects the first available workspace

### Requirement: Active board selection persists across page reloads
The system SHALL save the active board id to `localStorage` under key `railyn.activeBoardId` whenever the active board changes. On startup, the system SHALL restore the saved board if it exists in the loaded boards list AND belongs to the active workspace; otherwise it SHALL fall back to the first board of the active workspace.

#### Scenario: Saved board restored on reload
- **WHEN** the user has previously selected a board and reloads the page
- **THEN** the same board is active after reload without any user action

#### Scenario: Fallback when saved board no longer exists
- **WHEN** the persisted board id is not present in the loaded boards list
- **THEN** the system selects the first board of the active workspace

#### Scenario: Fallback when saved board belongs to a different workspace
- **WHEN** the persisted board id exists but belongs to a workspace other than the active workspace
- **THEN** the system selects the first board of the active workspace

#### Scenario: No entry yet — defaults to first board
- **WHEN** no `railyn.activeBoardId` key exists in localStorage
- **THEN** the system behaves as before and selects the first available board
