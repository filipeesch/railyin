## Purpose
The task Info tab surfaces project context, worktree metadata, and the task description in a read-friendly format with an inline edit action.

## Requirements

### Requirement: Info tab displays project information
The system SHALL display the task's project name and project key in the Info tab.

#### Scenario: Project info is shown
- **WHEN** the Info tab is active and the task has an associated project
- **THEN** the board name and project key are displayed

### Requirement: Info tab displays worktree and branch metadata
The system SHALL display the task's branch name, worktree path, and worktree status in the Info tab when available. When `worktreeStatus` is `ready`, a delete button SHALL appear next to the path. When `worktreeStatus` is `not_created`, `removed`, or `error`, an inline action form SHALL appear instead of or alongside the metadata rows.

#### Scenario: Branch name is shown when set
- **WHEN** the Info tab is active and the task has a branch name
- **THEN** the branch name is displayed

#### Scenario: Worktree path is shown with delete button when ready
- **WHEN** the Info tab is active and `worktreeStatus` is `ready`
- **THEN** the worktree path and a delete button are displayed

#### Scenario: Worktree status is shown when set
- **WHEN** the Info tab is active and the task has a worktree status
- **THEN** the worktree status is displayed

#### Scenario: Worktree section is always shown when git context exists
- **WHEN** the task has any `worktreeStatus` value (including `not_created`)
- **THEN** the Worktree section is rendered with the appropriate controls

### Requirement: User can delete a worktree from the Info tab
The system SHALL display a delete button next to the worktree path when `worktreeStatus` is `ready`. Clicking it SHALL show an inline confirmation before calling `tasks.removeWorktree`.

#### Scenario: Delete button is visible when worktree is ready
- **WHEN** the Info tab is active and `worktreeStatus` is `ready`
- **THEN** a delete icon button is shown next to the worktree path row

#### Scenario: Delete button is disabled while agent is running
- **WHEN** `executionState` is `running`
- **THEN** the delete button is disabled and cannot be clicked

#### Scenario: Delete confirmation shown before removal
- **WHEN** the user clicks the delete button
- **THEN** an inline confirmation prompt appears showing the worktree path and warning that the task and branch will be kept

#### Scenario: Cancel dismisses the confirmation
- **WHEN** the user clicks Cancel in the confirmation
- **THEN** the confirmation is dismissed and no API call is made

#### Scenario: Confirm calls removeWorktree and updates task
- **WHEN** the user confirms deletion
- **THEN** `tasks.removeWorktree` is called; on success the task is updated via WebSocket push and the create form becomes visible

#### Scenario: Warning message shown on partial removal failure
- **WHEN** `tasks.removeWorktree` returns `{ warning }`
- **THEN** the warning text is displayed inline before the UI transitions to the create form state

### Requirement: User can create a worktree from the Info tab
The system SHALL display an inline create form when `worktreeStatus` is `not_created` or `removed` and `executionState` is not `running`. The form SHALL offer two modes: new branch and existing branch.

#### Scenario: Create form is visible when no worktree exists
- **WHEN** `worktreeStatus` is `not_created` or `removed` and the agent is not running
- **THEN** the create form is displayed inline within the Worktree section

#### Scenario: Create form is hidden while agent is running
- **WHEN** `executionState` is `running`
- **THEN** no create form is shown regardless of `worktreeStatus`

#### Scenario: New branch mode is selected by default
- **WHEN** the create form first renders
- **THEN** the "New branch" radio is selected, showing branch name and source branch inputs

#### Scenario: Branch name pre-filled with task slug
- **WHEN** the create form renders in new branch mode
- **THEN** the branch name input is pre-filled with `task/<id>-<slugified-title>`

#### Scenario: Path pre-filled with computed default
- **WHEN** the create form renders
- **THEN** the path input is pre-filled with `<worktreeBasePath>/task/<id>-<slugified-title>`

#### Scenario: Source branch dropdown populated from listBranches
- **WHEN** the create form renders
- **THEN** `tasks.listBranches` is called and the source branch dropdown is populated with the returned branches

#### Scenario: Existing branch mode shows branch dropdown only
- **WHEN** the user selects "Existing branch" mode
- **THEN** the branch name text input and source branch dropdown are replaced by a single existing-branch dropdown; no "From" field is shown

#### Scenario: Create button calls createWorktree with correct params
- **WHEN** the user clicks Create in new branch mode
- **THEN** `tasks.createWorktree` is called with `mode: 'new'`, `branchName`, `sourceBranch`, and `path`

#### Scenario: Create button in existing mode passes branchName only
- **WHEN** the user clicks Create in existing branch mode
- **THEN** `tasks.createWorktree` is called with `mode: 'existing'`, `branchName` (selected branch), and `path`; no `sourceBranch` is sent

#### Scenario: Create button shows loading state during creation
- **WHEN** `tasks.createWorktree` is in flight
- **THEN** the Create button shows a loading indicator and cannot be clicked again

#### Scenario: After creation, create form collapses
- **WHEN** the task is updated via WebSocket with `worktreeStatus: 'ready'`
- **THEN** the create form collapses and the branch/path/status rows are displayed

### Requirement: Worktree error state shows retry option
The system SHALL display a retry button when `worktreeStatus` is `error`. Clicking it SHALL expand the same create form pre-filled with defaults.

#### Scenario: Retry button visible on error
- **WHEN** `worktreeStatus` is `error`
- **THEN** an error indicator and a Retry button are shown in the Worktree section

#### Scenario: Retry expands create form
- **WHEN** the user clicks Retry
- **THEN** the create form expands inline, pre-filled with the auto-computed branch name and path

#### Scenario: Create failure shows error message
- **WHEN** `tasks.createWorktree` rejects with an error
- **THEN** the error message is displayed inline in the create form and the Create button is re-enabled

### Requirement: Worktree creating state shows a spinner
The system SHALL display a loading indicator when `worktreeStatus` is `creating` and suppress all interactive controls.

#### Scenario: Spinner shown while creating
- **WHEN** `worktreeStatus` is `creating`
- **THEN** a spinner or progress indicator is shown and no delete or create controls are visible

### Requirement: Info tab displays task description rendered as markdown with an inline edit action
The system SHALL display the task's description as rendered markdown in the Info tab, with an edit button inline next to the Description heading.

#### Scenario: Description is rendered as markdown
- **WHEN** the Info tab is active and the task has a description
- **THEN** the description is displayed as rendered markdown

#### Scenario: Edit button opens the task edit dialog
- **WHEN** the user clicks the edit button in the Info tab
- **THEN** the task edit overlay opens

#### Scenario: Description section is shown even when description is empty
- **WHEN** the Info tab is active and the task description is empty
- **THEN** the description section is still rendered with the edit button available
