## MODIFIED Requirements

### Requirement: Task title and description can be edited before worktree is created
The system SHALL allow a user to edit a task's title and description while the task's worktree has not yet been created (`worktree_status = 'not_created'`). Once a worktree exists, editing SHALL be locked.

#### Scenario: Edit action available before worktree exists
- **WHEN** a task's `worktree_status` is `not_created`
- **THEN** an edit action (e.g. pencil icon) is available in the task detail drawer header or task card menu

#### Scenario: Edits persisted via tasks.update
- **WHEN** the user saves edited title and/or description
- **THEN** the task's `title` and `description` are updated in the database and the board card reflects the new title

#### Scenario: Edit locked once worktree exists
- **WHEN** a task's `worktree_status` is `creating` or `ready`
- **THEN** the edit action is disabled with a tooltip explaining the lock (e.g. "Branch already created")

## ADDED Requirements

### Requirement: Task fields have conditional editability based on column position
The system SHALL implement conditional editability for task fields where title and project are editable only when the task is in the backlog column, regardless of worktree status.

#### Scenario: Task fields editable when in backlog column
- **WHEN** a task is positioned in the backlog column
- **THEN** the task title and project fields are editable in the task overlay

#### Scenario: Task fields readonly when not in backlog column
- **WHEN** a task is positioned in any column other than backlog
- **THEN** the task title and project fields are readonly in the task overlay

#### Scenario: Description content still editable in non-backlog columns
- **WHEN** a task is positioned in any column including non-backlog columns
- **THEN** the task description can still be viewed in Preview/Edit modes in the task overlay

### Requirement: Task overlay save button hidden for non-backlog tasks
The system SHALL hide the save button in the task overlay when editing a task that is not in the backlog column.

#### Scenario: Save button visible for backlog tasks
- **WHEN** a task in the backlog column is being edited in the overlay
- **THEN** the save button is visible and enabled

#### Scenario: Save button hidden for non-backlog tasks
- **WHEN** a task not in the backlog column is being edited in the overlay
- **THEN** the save button is hidden