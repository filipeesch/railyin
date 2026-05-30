## MODIFIED Requirements

### Requirement: Info tab displays project information
The system SHALL display the task's project name and project key in the Info tab.

#### Scenario: Project info is shown
- **WHEN** the Info tab is active and the task has an associated project
- **THEN** the board name and project key are displayed

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

## REMOVED Requirements

### Requirement: Info tab displays worktree and branch metadata
**Reason**: Worktree management is a git-specific concern and has been moved to the dedicated Git tab.
**Migration**: Users should use the Git tab to view and manage worktree branch, path, and status.

### Requirement: User can delete a worktree from the Info tab
**Reason**: Moved to the Git tab.
**Migration**: Use the Git tab to delete a worktree.

### Requirement: User can create a worktree from the Info tab
**Reason**: Moved to the Git tab.
**Migration**: Use the Git tab to create a worktree.

### Requirement: Worktree error state shows retry option
**Reason**: Moved to the Git tab.
**Migration**: Use the Git tab to retry worktree creation.

### Requirement: Worktree creating state shows a spinner
**Reason**: Moved to the Git tab.
**Migration**: Worktree creation progress is now shown in the Git tab.
