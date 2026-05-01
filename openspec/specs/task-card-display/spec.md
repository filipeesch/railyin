## ADDED Requirements

### Requirement: Task card shows project name
The task card SHALL display the name of the project the task belongs to, resolved from the task's `projectKey` against the loaded project list. The project name SHALL appear right-aligned in the card footer row, in the same horizontal line as the execution-state badge. When the project name cannot be resolved, the raw `projectKey` SHALL be shown as a fallback.

#### Scenario: Project name visible on card
- **WHEN** a task card is rendered and the project is found in the project store
- **THEN** the project's `name` is displayed right-aligned in the footer row

#### Scenario: Fallback to project key when project not loaded
- **WHEN** a task card is rendered and the project list has not yet loaded
- **THEN** the task's `projectKey` string is displayed in place of the project name

#### Scenario: Long project name is truncated
- **WHEN** the project name exceeds the available width in the footer row
- **THEN** the name is truncated with an ellipsis and does not overflow the card boundary

### Requirement: Task card does not show file-changes counter
The task card SHALL NOT display a file-changes counter or any badge linking to the code review overlay. Code review is accessible exclusively from the task detail drawer.

#### Scenario: No file-changes badge on card
- **WHEN** a task has changed files in its worktree
- **THEN** no file-changes counter or review trigger appears on the task card

### Requirement: Task card does not show retry count
The task card SHALL NOT display a retry count indicator. Retry history is available in the task detail drawer.

#### Scenario: No retry indicator on card
- **WHEN** a task has a `retryCount` greater than zero
- **THEN** no retry indicator is shown on the task card
