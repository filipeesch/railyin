## Purpose
The task Info tab surfaces project context, worktree metadata, and the task description in a read-friendly format with an inline edit action.
## Requirements
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

