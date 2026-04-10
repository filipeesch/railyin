## ADDED Requirements

### Requirement: Task stores shell auto-approve preference
Each task SHALL have a `shell_auto_approve` boolean field (stored as `INTEGER DEFAULT 0` in SQLite). When `true`, all `run_command` calls for the task bypass the binary approval gate. The field SHALL be exposed in `TaskRow`, mapped in `mapTask`, included in the `Task` RPC type, and readable from the task store on the frontend.

#### Scenario: shell_auto_approve defaults to false
- **WHEN** a new task is created
- **THEN** `shell_auto_approve` is `0` (false) in the DB

#### Scenario: shell_auto_approve included in task RPC response
- **WHEN** any RPC that returns a Task object is called
- **THEN** the response includes the `shellAutoApprove` boolean field

#### Scenario: shell_auto_approve persists through column transitions
- **WHEN** a task is moved to a new column
- **THEN** `shell_auto_approve` is not modified and retains its current value

### Requirement: Task stores per-task approved command binaries
Each task SHALL have an `approved_commands` field (stored as `TEXT DEFAULT '[]'` in SQLite, containing a JSON array of binary name strings). The system SHALL provide helpers to read and append to this field. The field SHALL be exposed in `TaskRow`, mapped in `mapTask`, included in the `Task` RPC type, and readable from the task store on the frontend.

#### Scenario: approved_commands defaults to empty array
- **WHEN** a new task is created
- **THEN** `approved_commands` is `'[]'` in the DB

#### Scenario: Approved binaries appended correctly
- **WHEN** the engine appends `["git", "bun"]` to an existing `approved_commands` value of `["npm"]`
- **THEN** the stored value becomes `["npm", "git", "bun"]`

#### Scenario: approved_commands included in task RPC response
- **WHEN** any RPC that returns a Task object is called
- **THEN** the response includes the `approvedCommands` field as an array of strings

#### Scenario: approved_commands persists through column transitions
- **WHEN** a task moves to a new workflow column
- **THEN** `approved_commands` retains all previously stored binary names
