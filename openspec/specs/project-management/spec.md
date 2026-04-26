## Purpose
Project management covers the UI-driven lifecycle of registered projects within a workspace: creating, editing, and deleting projects through the Setup view without editing `workspace.yaml` directly.

## Requirements

### Requirement: User can edit an existing project
The system SHALL allow users to update any field of a registered project (name, project path, git root path, default branch, slug, description) through the Setup view.

#### Scenario: Project fields updated via dialog
- **WHEN** the user clicks Edit on a registered project, modifies one or more fields in the ProjectDetailDialog, and saves
- **THEN** the updated values are written to the project entry in `workspace.yaml` and the project list reflects the changes

#### Scenario: Auto-detect git root from project path
- **WHEN** the user sets or changes the project path field in the ProjectDetailDialog
- **THEN** the dialog offers a "Detect git root" button that calls `workspace.resolveGitRoot` and auto-fills the Git root field with the result, leaving the user free to override it

#### Scenario: Git root detection fails gracefully
- **WHEN** the user clicks "Detect git root" for a path that is not inside a Git repository
- **THEN** the Git root field is not changed and an inline message informs the user that no Git root was found

### Requirement: User can delete a project with cascade warning
The system SHALL allow users to delete a registered project. Before deletion, the system SHALL display a confirmation alert that describes the cascade impact. On confirmation, all tasks belonging to the project SHALL be deleted along with their conversation history.

#### Scenario: Delete project shows cascade warning
- **WHEN** the user clicks Delete on a project that has associated tasks
- **THEN** a confirmation dialog shows the count of tasks that will be permanently deleted before the user can confirm

#### Scenario: Delete project with no tasks
- **WHEN** the user clicks Delete on a project that has no associated tasks
- **THEN** a confirmation dialog confirms the action without mentioning task deletion

#### Scenario: Project and tasks removed after confirmation
- **WHEN** the user confirms the deletion
- **THEN** the project is removed from `workspace.yaml`, all tasks with that `project_key` are deleted from the database, and the project no longer appears in the list

#### Scenario: Deletion cancelled leaves project intact
- **WHEN** the user dismisses the confirmation dialog
- **THEN** the project and its tasks remain unchanged

### Requirement: Project list is shown before the registration form
The system SHALL display the list of already-registered projects at the top of the Projects tab, above the form to add a new project, so users can see and manage existing projects without scrolling.

#### Scenario: Existing projects shown with edit and delete actions
- **WHEN** the Projects tab is open and at least one project is registered for the active workspace
- **THEN** each project appears as a row with its name, project path, and Edit / Delete action buttons
