## ADDED Requirements

### Requirement: Info tab displays project information
The system SHALL display the task's project name and project key in the Info tab.

#### Scenario: Project info is shown
- **WHEN** the Info tab is active and the task has an associated project
- **THEN** the board name and project key are displayed

### Requirement: Info tab displays worktree and branch metadata
The system SHALL display the task's branch name, worktree path, and worktree status in the Info tab when available.

#### Scenario: Branch name is shown when set
- **WHEN** the Info tab is active and the task has a branch name
- **THEN** the branch name is displayed

#### Scenario: Worktree path is shown when set
- **WHEN** the Info tab is active and the task has a worktree path
- **THEN** the worktree path is displayed

#### Scenario: Worktree status is shown when set
- **WHEN** the Info tab is active and the task has a worktree status
- **THEN** the worktree status is displayed

#### Scenario: Worktree section is hidden when no branch or worktree info
- **WHEN** the task has no branch name, worktree path, or worktree status
- **THEN** the worktree section is not rendered in the Info tab

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
