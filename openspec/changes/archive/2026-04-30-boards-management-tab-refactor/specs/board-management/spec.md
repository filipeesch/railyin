## ADDED Requirements

### Requirement: User can create a board from the Setup UI
The system SHALL allow users to create a new board by providing a name, selecting a workflow template, and optionally assigning projects, all through a `BoardDetailDialog` in the Setup view's Boards tab.

#### Scenario: Board created with name and workflow
- **WHEN** the user opens the "Add board" dialog, enters a name, selects a workflow template, and clicks "Create board"
- **THEN** the new board appears in the board list in the Boards tab and becomes selectable in the board header

#### Scenario: Create button disabled until required fields filled
- **WHEN** the board name field is empty or no workflow template is selected
- **THEN** the "Create board" button is disabled

#### Scenario: Board created with project assignments
- **WHEN** the user checks one or more projects in the project checkbox list before saving
- **THEN** the created board has those project keys in its `projectKeys` array

### Requirement: User can rename a board from the Setup UI
The system SHALL allow users to rename an existing board through the `BoardDetailDialog` opened from the Boards tab Edit button. The updated name SHALL be reflected in the board list and in the board selector header immediately after save.

#### Scenario: Board renamed successfully
- **WHEN** the user clicks Edit on a board, changes the name, and saves
- **THEN** the board name is updated in the database, the Boards tab list shows the new name, and the board selector in `BoardView` shows the new name

#### Scenario: Save disabled when name is empty
- **WHEN** the user clears the board name field in the edit dialog
- **THEN** the save button is disabled

### Requirement: User can reassign projects to a board from the Setup UI
The system SHALL allow users to change the set of projects assigned to a board via the project checkbox list in `BoardDetailDialog`. The updated `projectKeys` SHALL be persisted and reflected immediately.

#### Scenario: Project assignment updated
- **WHEN** the user edits a board and toggles project checkboxes, then saves
- **THEN** the board's `projectKeys` array is updated to reflect the new selection

#### Scenario: No projects assigned is a valid state
- **WHEN** the user unchecks all projects and saves
- **THEN** the board is saved with an empty `projectKeys` array without error

### Requirement: User can change the workflow template of a board from the Setup UI
The system SHALL allow users to change a board's associated workflow template through the edit dialog. When the board has existing tasks and the template is changed, the dialog SHALL display a non-blocking inline warning about potential task orphaning.

#### Scenario: Workflow template changed without tasks
- **WHEN** the user edits a board with no tasks and selects a different workflow template, then saves
- **THEN** the board's `workflowTemplateId` is updated without any warning

#### Scenario: Inline warning shown when changing workflow on board with tasks
- **WHEN** the user edits a board that has at least one task and selects a different workflow template in the dialog
- **THEN** an inline warning message is shown: "This board has tasks. Changing the workflow may orphan tasks not mapped to the new template."

#### Scenario: Warning does not block save
- **WHEN** the inline workflow-change warning is visible
- **THEN** the save button remains enabled and the user can proceed

### Requirement: User can delete an empty board from the Setup UI
The system SHALL allow users to delete a board that has no tasks through a confirmation dialog. The deleted board SHALL be removed from the board list and the board selector immediately.

#### Scenario: Empty board deleted after confirmation
- **WHEN** the user clicks Delete on a board with no tasks and confirms the dialog
- **THEN** the board is removed from the database, the Boards tab list no longer shows it, and the board selector no longer includes it

#### Scenario: Delete confirm dialog shown only for empty boards
- **WHEN** the user clicks Delete on a board with no tasks
- **THEN** a confirmation dialog is shown asking the user to confirm deletion

### Requirement: Deleting a board with tasks is blocked with a toast
The system SHALL prevent deletion of a board that has tasks. When the user clicks Delete on such a board, no confirmation dialog SHALL appear; instead a warning toast SHALL be shown instructing the user to remove tasks first.

#### Scenario: Delete blocked by toast when board has tasks
- **WHEN** the user clicks Delete on a board that has one or more tasks
- **THEN** no confirmation dialog appears and a warning toast is shown: "Board has N task(s). Remove all tasks first before deleting."

#### Scenario: Backend independently rejects delete of board with tasks
- **WHEN** the `boards.delete` RPC is called for a board that has tasks (regardless of frontend state)
- **THEN** the backend returns an error: "Board has N task(s). Remove them first."

### Requirement: boards.update RPC persists board mutations
The system SHALL expose a `boards.update` RPC that accepts an id and optional fields (name, workflowTemplateId, projectKeys). It SHALL validate that the workflow template exists in workspace config and return the updated Board.

#### Scenario: Name updated via boards.update
- **WHEN** `boards.update` is called with `{ id, name: "New Name" }`
- **THEN** the board's name is updated in the database and the updated Board is returned

#### Scenario: workflowTemplateId updated via boards.update
- **WHEN** `boards.update` is called with `{ id, workflowTemplateId: "sprint" }`
- **THEN** the board's template ID is updated in the database

#### Scenario: Invalid workflowTemplateId rejected
- **WHEN** `boards.update` is called with a workflowTemplateId that does not exist in workspace config
- **THEN** the handler throws an error without modifying the board

#### Scenario: projectKeys updated via boards.update
- **WHEN** `boards.update` is called with `{ id, projectKeys: ["proj-a", "proj-b"] }`
- **THEN** the board's project_keys column is updated with the new JSON array

### Requirement: boards.delete RPC removes empty boards
The system SHALL expose a `boards.delete` RPC that removes a board by id if and only if it has no tasks. If the board has tasks, it SHALL throw an error.

#### Scenario: Empty board deleted via boards.delete
- **WHEN** `boards.delete` is called for a board with no tasks
- **THEN** the board row is removed from the database

#### Scenario: boards.delete blocked when board has tasks
- **WHEN** `boards.delete` is called for a board that has one or more tasks
- **THEN** an error is thrown: "Board has N task(s). Remove them first." and the board is not deleted
