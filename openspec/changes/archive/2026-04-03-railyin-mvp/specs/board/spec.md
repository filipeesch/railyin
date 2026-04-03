## ADDED Requirements

### Requirement: Board coordinates tasks across one or more projects
The system SHALL allow a board to be linked to one or more registered projects. Tasks on the board each belong to exactly one of those projects.

#### Scenario: Board created with a project
- **WHEN** a user creates a board and links it to one or more projects
- **THEN** tasks can be created on that board scoped to any of the linked projects

#### Scenario: Board displays tasks from multiple projects
- **WHEN** a board is linked to multiple projects
- **THEN** task cards on the board display a project badge identifying which project each task belongs to

### Requirement: Board uses a configurable workflow template
The system SHALL associate each board with a workflow template that defines its columns, column order, `on_enter_prompt`, and `stage_instructions`. Templates are defined in YAML configuration files.

#### Scenario: Board renders columns from template
- **WHEN** a board is opened
- **THEN** the board displays columns in the order defined by its associated workflow template

#### Scenario: Invalid template blocks board display
- **WHEN** a board's associated workflow template YAML is missing or invalid
- **THEN** the board displays a configuration error instead of columns

### Requirement: Board shows task cards with dual state
The system SHALL display each task as a card in its current workflow column, showing both the workflow state (column name) and execution state as a badge.

#### Scenario: Task card reflects execution state
- **WHEN** a task's execution state changes
- **THEN** the task card updates its badge without requiring a page reload

#### Scenario: Board is a summary view only
- **WHEN** a user views the board
- **THEN** each task card shows title, project badge, and execution state badge — not the full conversation

### Requirement: Board supports task transitions
The system SHALL allow a user to move a task from one workflow column to another by interacting with the board. The task's workflow state SHALL update immediately upon transition.

#### Scenario: Task moves to target column immediately
- **WHEN** a user moves a task to a different column
- **THEN** the task appears in the target column immediately and its `workflow_state` is updated

#### Scenario: Transition triggers execution
- **WHEN** a task is moved to a column that has an `on_enter_prompt` configured
- **THEN** a new execution is created and the prompt begins running after the task moves
