## ADDED Requirements

### Requirement: Code editor button in toolbar opens code-server for the task
The system SHALL render a code editor button (`</>`) in the toolbar action cluster, positioned to the right of the terminal button, that opens the code editor overlay for the active task.

#### Scenario: Code editor button is visible when worktree path is set
- **WHEN** the task has a worktree path
- **THEN** the code editor button (`</>`) is visible in the toolbar action cluster, to the right of the terminal button

#### Scenario: Code editor button is hidden when no worktree path
- **WHEN** the task does not have a worktree path
- **THEN** the code editor button is not rendered in the toolbar

#### Scenario: Clicking code editor button opens the code editor overlay
- **WHEN** the user clicks the code editor button
- **THEN** the system opens the CodeServerOverlay for the active task
