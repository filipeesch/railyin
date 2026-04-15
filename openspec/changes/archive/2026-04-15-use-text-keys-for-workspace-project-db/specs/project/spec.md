## MODIFIED Requirements

### Requirement: Task belongs to exactly one project
The system SHALL enforce that each task is associated with exactly one project. This association is stored as `project_key TEXT` — the string key of the project within its workspace — and cannot be changed after task creation.

#### Scenario: Task created under a project
- **WHEN** a user creates a task on a board
- **THEN** the user must select one of the board's linked projects to own the task and the task row stores the project's string key

#### Scenario: Task project cannot be changed
- **WHEN** a task already exists
- **THEN** the system does not provide a mechanism to reassign it to a different project

#### Scenario: Task row carries project_key
- **WHEN** a task is queried
- **THEN** the `project_key` column contains the string key of the owning project (e.g. `"my-app"`) not a hash-derived integer
