# git-tab Specification

## Purpose
TBD - created by archiving change create-git-tab. Update Purpose after archive.
## Requirements
### Requirement: A Git tab is available in the task chat drawer
The system SHALL render a Git tab in the drawer toolbar tab switcher, positioned after the Info tab and before the Decisions tab. Clicking the Git tab SHALL display the Git tab content panel.

#### Scenario: Git tab is visible in the toolbar
- **WHEN** the task detail drawer is open
- **THEN** a Git tab button is visible in the toolbar tab switcher alongside Chat, Info, and Decisions

#### Scenario: Switching to Git tab shows Git content
- **WHEN** the user clicks the Git tab
- **THEN** the Git tab becomes active and the drawer body shows the Git tab content (worktree management)

### Requirement: Git tab displays worktree and branch metadata
The system SHALL display the task's branch name, worktree path, and worktree status in the Git tab when available. When `worktreeStatus` is `ready`, a delete button SHALL appear next to the path. When `worktreeStatus` is `not_created`, `removed`, or `error`, an inline create form SHALL appear.

#### Scenario: Branch name is shown when set
- **WHEN** the Git tab is active and the task has a branch name
- **THEN** the branch name is displayed

#### Scenario: Worktree path is shown with delete button when ready
- **WHEN** the Git tab is active and `worktreeStatus` is `ready`
- **THEN** the worktree path and a delete button are displayed

#### Scenario: Worktree status is shown when set
- **WHEN** the Git tab is active and the task has a worktree status
- **THEN** the worktree status is displayed

#### Scenario: Worktree section is shown when git context exists
- **WHEN** the task has any `worktreeStatus` value (including `not_created`)
- **THEN** the Worktree section is rendered with the appropriate controls

### Requirement: User can delete a worktree from the Git tab
The system SHALL display a delete button next to the worktree path when `worktreeStatus` is `ready`. Clicking it SHALL show an inline confirmation before calling `tasks.removeWorktree`.

#### Scenario: Delete button is visible when worktree is ready
- **WHEN** the Git tab is active and `worktreeStatus` is `ready`
- **THEN** a delete icon button is shown next to the worktree path row

#### Scenario: Delete button is disabled while agent is running
- **WHEN** `executionState` is `running`
- **THEN** the delete button is disabled

#### Scenario: Delete confirmation shown before removal
- **WHEN** the user clicks the delete button
- **THEN** an inline confirmation prompt appears showing the worktree path

#### Scenario: Cancel dismisses the confirmation
- **WHEN** the user clicks Cancel in the confirmation
- **THEN** the confirmation is dismissed and no API call is made

#### Scenario: Confirm calls removeWorktree and updates task
- **WHEN** the user confirms deletion
- **THEN** `tasks.removeWorktree` is called; on success the task is updated via WebSocket push

#### Scenario: Warning message shown on partial removal failure
- **WHEN** `tasks.removeWorktree` returns `{ warning }`
- **THEN** the warning text is displayed inline

### Requirement: User can create a worktree from the Git tab
The system SHALL display an inline create form in the Git tab when `worktreeStatus` is `not_created` or `removed` and `executionState` is not `running`. The form SHALL offer two modes: new branch and existing branch.

#### Scenario: Create form is visible when no worktree exists
- **WHEN** the Git tab is active, `worktreeStatus` is `not_created` or `removed`, and the agent is not running
- **THEN** the create form is displayed inline

#### Scenario: Create form is hidden while agent is running
- **WHEN** `executionState` is `running`
- **THEN** no create form is shown

#### Scenario: Branch name pre-filled with task slug
- **WHEN** the create form renders in new branch mode
- **THEN** the branch name input is pre-filled with `task/<id>-<slugified-title>`

#### Scenario: Source branch dropdown populated from listBranches
- **WHEN** the create form renders
- **THEN** `tasks.listBranches` is called and the source branch dropdown is populated

#### Scenario: Create button calls createWorktree with correct params
- **WHEN** the user clicks Create in new branch mode
- **THEN** `tasks.createWorktree` is called with `mode: 'new'`, `branchName`, `sourceBranch`, and `path`

#### Scenario: After creation, create form collapses
- **WHEN** the task is updated via WebSocket with `worktreeStatus: 'ready'`
- **THEN** the create form collapses and branch/path/status rows are displayed

### Requirement: Worktree error state shows retry option in Git tab
The system SHALL display a retry button when `worktreeStatus` is `error`. Clicking it SHALL expand the create form.

#### Scenario: Retry button visible on error
- **WHEN** the Git tab is active and `worktreeStatus` is `error`
- **THEN** an error indicator and a Retry button are shown

#### Scenario: Retry expands create form
- **WHEN** the user clicks Retry
- **THEN** the create form expands inline

### Requirement: Worktree creating state shows a spinner in Git tab
The system SHALL display a loading indicator when `worktreeStatus` is `creating`.

#### Scenario: Spinner shown while creating
- **WHEN** the Git tab is active and `worktreeStatus` is `creating`
- **THEN** a spinner is shown and no interactive controls are visible

