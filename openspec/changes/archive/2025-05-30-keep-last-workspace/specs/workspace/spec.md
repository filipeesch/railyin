## ADDED Requirements

### Requirement: Active workspace selection is persisted to localStorage
See `board-selection-persistence` capability spec for full requirements.
This is captured here as a delta to the `workspace` capability to record that the workspace store now owns localStorage persistence of `activeWorkspaceKey`.

#### Scenario: Workspace store writes activeWorkspaceKey to localStorage on change
- **WHEN** the active workspace key changes in the workspace store
- **THEN** the new value is written to `localStorage` under key `railyn.activeWorkspaceKey`
