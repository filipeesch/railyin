## Purpose
Defines how and where the task creation entry point is surfaced on the board, enabling users to create tasks contextually from the backlog column.

## Requirements

### Requirement: Create task button positioned in backlog column header
The system SHALL position the "Create Task" button below the backlog column title for contextual task creation.

#### Scenario: Create task button visible in backlog column
- **WHEN** the board view is displayed
- **THEN** a "Create Task" button is visible below the backlog column title

#### Scenario: Create task button opens task creation overlay
- **WHEN** the user clicks the "Create Task" button in the backlog column
- **THEN** the task creation overlay opens

#### Scenario: Create task button only visible in backlog column
- **WHEN** the board view is displayed
- **THEN** the "Create Task" button is only visible in the backlog column, not in other columns

### Requirement: Create task button maintains consistent styling
The system SHALL maintain the same visual design for the "Create Task" button as the current header button.

#### Scenario: Create task button matches current styling
- **WHEN** the create task button is displayed
- **THEN** it uses the same styling as the current header "New Task" button
