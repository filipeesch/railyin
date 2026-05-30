## ADDED Requirements

### Requirement: Active board selection is persisted to localStorage
See `board-selection-persistence` capability spec for full requirements.
This is captured here as a delta to the `board` capability to record that the board store now owns localStorage persistence of `activeBoardId`.

#### Scenario: Board store writes activeBoardId to localStorage on change
- **WHEN** the active board id changes in the board store
- **THEN** the new value is written to `localStorage` under key `railyn.activeBoardId`
