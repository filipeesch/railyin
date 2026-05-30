## ADDED Requirements

### Requirement: Git tab button is visible in the task drawer toolbar
The task drawer toolbar SHALL display a "Git" tab button between the "Info" and "Decisions" buttons.

#### Scenario: Git tab button visible
- **WHEN** user opens the task drawer
- **THEN** a tab button labelled "Git" is visible in the toolbar

#### Scenario: Tab order is Chat, Info, Git, Decisions
- **WHEN** user opens the task drawer
- **THEN** tab buttons appear left-to-right in the order: Chat, Info, Git, Decisions

### Requirement: Clicking Git tab shows worktree content
The system SHALL render the worktree management content when the Git tab is active.

#### Scenario: Git tab shows worktree section
- **WHEN** user clicks the "Git" tab button
- **THEN** the `.task-tab-git` panel is visible
- **AND** worktree content is rendered (create form or status depending on worktreeStatus)

#### Scenario: Git tab is navigable from Chat tab
- **WHEN** user is on the Chat tab
- **AND** clicks the Git tab button
- **THEN** the Git tab content is visible

### Requirement: Info tab does not contain worktree content after the move
The Info tab SHALL NOT render any worktree section, branch name, worktree path, delete button, or create form after the Git tab is introduced.

#### Scenario: Info tab has no Worktree section for ready task
- **WHEN** the task has worktreeStatus "ready"
- **AND** user opens the Info tab
- **THEN** no section labelled "Worktree" is visible in `.task-tab-info`

#### Scenario: Info tab has no create form for not_created task
- **WHEN** the task has worktreeStatus "not_created"
- **AND** user opens the Info tab
- **THEN** no `.wt-create-form` element is visible in `.task-tab-info`

### Requirement: Delete confirmation state resets on tab switch
The in-progress delete confirmation SHALL be dismissed if the user navigates away from the Git tab.

#### Scenario: Delete confirmation dismissed on tab switch
- **WHEN** user opens the delete confirmation in the Git tab (clicks trash icon)
- **AND** switches to the Chat tab
- **AND** switches back to the Git tab
- **THEN** the delete confirmation is no longer visible
- **AND** the delete button is shown without the confirmation overlay

### Requirement: Git tab content remains live-reactive to WS task updates
The Git tab content SHALL update when a WebSocket `task.updated` push arrives while the Git tab is active.

#### Scenario: WS push updates worktree status while Git tab is active
- **WHEN** user is on the Git tab
- **AND** a WebSocket push sets worktreeStatus to "ready"
- **THEN** the Git tab displays the ready state (branch name + path + delete button) without requiring a tab switch
