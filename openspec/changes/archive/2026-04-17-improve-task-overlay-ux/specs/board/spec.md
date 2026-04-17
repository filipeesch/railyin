## ADDED Requirements

### Requirement: Board column header includes contextual task creation button
The system SHALL display a task creation button below the backlog column title for contextual task creation.

#### Scenario: Create task button visible in backlog column header
- **WHEN** the board view is displayed
- **THEN** a "Create Task" button is visible below the backlog column title

#### Scenario: Create task button opens task creation dialog
- **WHEN** the user clicks the "Create Task" button in the backlog column header
- **THEN** the task creation dialog opens

#### Scenario: Create task button only visible in backlog column
- **WHEN** the board view is displayed
- **THEN** the "Create Task" button is only visible in the backlog column header, not in other column headers