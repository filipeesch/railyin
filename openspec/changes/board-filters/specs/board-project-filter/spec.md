## ADDED Requirements

### Requirement: Board displays project filter Select
The board header SHALL include a project filter Select component positioned in the right-side toolbar, between the board selector and the utility buttons. The Select SHALL display project names as labels and project keys as values.

#### Scenario: Project filter is visible on the board
- **WHEN** a board is loaded and the user has projects in the current workspace
- **THEN** a project filter Select is displayed in the board header's right side

#### Scenario: Project filter shows empty when no projects exist
- **WHEN** the current workspace has no projects
- **THEN** the project filter Select is present but contains no options

### Requirement: Project filter options respect board projectKeys
The project filter Select options SHALL be the intersection of the current workspace's projects and the active board's `projectKeys` array. If the board has no `projectKeys` configured, all workspace projects SHALL be shown.

#### Scenario: Filter shows board-scoped projects
- **WHEN** the active board has `projectKeys: ["frontend", "backend"]` and the workspace has projects `["frontend", "backend", "infra"]`
- **THEN** the project filter Select offers only "frontend" and "backend" as options

#### Scenario: Filter shows all workspace projects when board has no projectKeys
- **WHEN** the active board has an empty `projectKeys` array
- **THEN** the project filter Select offers all projects from the current workspace

### Requirement: Selecting a project filters all columns
When a project is selected in the filter, only tasks belonging to that project SHALL be visible across all board columns. Tasks from other projects SHALL be hidden.

#### Scenario: Filter by single project
- **WHEN** user selects project "frontend" in the project filter
- **THEN** only tasks with `projectKey === "frontend"` appear in all board columns
- **AND** tasks with `projectKey !== "frontend"` are hidden from all columns

#### Scenario: Filter preserves column grouping
- **WHEN** a project filter is active and tasks are visible
- **THEN** visible tasks remain grouped by their workflow state in the correct columns

### Requirement: Deselecting the filter shows all tasks
When the project filter is reset to its default (no selection), all tasks for the board SHALL be visible again, matching the pre-filter behavior.

#### Scenario: Reset filter shows all tasks
- **WHEN** a project filter is active and user selects the default (empty) option
- **THEN** all tasks for the board become visible again in their respective columns

### Requirement: Filter state resets on board switch
When the user switches to a different board, the project filter SHALL reset to its default (no selection) state, showing all tasks for the new board.

#### Scenario: Switching boards resets filter
- **WHEN** user has a project filter active and switches to a different board
- **THEN** the project filter resets to "no selection" and all tasks for the new board are visible

### Requirement: Filter updates reactively with task changes
When tasks are added, removed, or have their `projectKey` changed (via backend events), the filter SHALL re-evaluate and update the visible task set.

#### Scenario: New task appears in filtered view
- **WHEN** a new task is created with a projectKey matching the active filter
- **THEN** the new task appears in the correct column

#### Scenario: New task filtered out
- **WHEN** a new task is created with a projectKey not matching the active filter
- **THEN** the new task does not appear in any column
