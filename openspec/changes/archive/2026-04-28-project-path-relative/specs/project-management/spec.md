## MODIFIED Requirements

### Requirement: User can edit an existing project
The system SHALL allow users to update any field of a registered project (name, project path, git root path, default branch, slug, description) through the Setup view. The `workspace_path` MUST be configured before a project can be edited; the dialog SHALL show an inline warning and disable save if `workspace_path` is not set.

#### Scenario: Project fields updated via dialog
- **WHEN** the user clicks Edit on a registered project, modifies one or more fields in the ProjectDetailDialog, and saves
- **THEN** the backend normalizes paths to relative (relative to `workspace_path`), validates containment inside `workspace_path`, and writes the updated values to `workspace.yaml`

#### Scenario: Auto-detect git root from project path
- **WHEN** the user sets or changes the project path field in the ProjectDetailDialog
- **THEN** the dialog offers a "Detect git root" button that calls `workspace.resolveGitRoot` and auto-fills the Git root field with the result, leaving the user free to override it

#### Scenario: Git root detection fails gracefully
- **WHEN** the user clicks "Detect git root" for a path that is not inside a Git repository
- **THEN** the Git root field is not changed and an inline message informs the user that no Git root was found

#### Scenario: workspace_path not set — save disabled with inline warning
- **WHEN** the user opens the ProjectDetailDialog and `workspace_path` is not configured for the workspace
- **THEN** an inline warning is shown ("workspace_path must be set before registering projects — configure it in Workspace settings") and the save button is disabled

#### Scenario: Path outside workspace_path rejected
- **WHEN** the user provides or browses to a project path that is outside the `workspace_path` folder
- **THEN** the backend returns an error and the dialog displays it inline without saving

### Requirement: User can register a new project
The system SHALL allow users to register a new project by providing a project path (via text input or folder-browse dialog). The backend SHALL accept an absolute or relative path, normalize it to a relative path (relative to `workspace_path`), validate that it exists on disk and resides inside `workspace_path`, and write the relative value to `workspace.yaml`. The `workspace_path` MUST be set before a project can be registered.

#### Scenario: New project registered via browse dialog
- **WHEN** the user clicks the browse button, selects an absolute folder path, and submits the form
- **THEN** the backend converts the absolute path to a relative path (`relative(workspace_path, selectedPath)`), validates the path exists and is inside `workspace_path`, and persists the relative path in `workspace.yaml`

#### Scenario: New project registered via text input with relative path
- **WHEN** the user types a relative path (e.g. `packages/ui`) and submits
- **THEN** the backend resolves it against `workspace_path`, validates existence and containment, and saves the relative value

#### Scenario: workspace_path not set — registration blocked
- **WHEN** the user attempts to register a project and `workspace_path` is not configured
- **THEN** the backend returns an error: "workspace_path must be set before registering projects"

#### Scenario: Project path outside workspace_path rejected
- **WHEN** the registered path resolves to a location outside `workspace_path`
- **THEN** the backend returns an error: "project_path must be inside workspace_path" and no YAML change is made

#### Scenario: Project path does not exist on disk — rejected
- **WHEN** the registered path does not exist on the filesystem
- **THEN** the backend returns an error and no YAML change is made

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
- **THEN** each project appears as a row with its name, project path (shown as relative), and Edit / Delete action buttons
