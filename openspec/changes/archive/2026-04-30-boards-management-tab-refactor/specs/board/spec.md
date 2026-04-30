## MODIFIED Requirements

### Requirement: Board coordinates tasks across one or more projects
The system SHALL allow a board to be linked to one or more registered projects. Tasks on the board each belong to exactly one of those projects. The project assignment SHALL be editable at any time through the Setup UI without requiring a board recreate.

#### Scenario: Board created with a project
- **WHEN** a user creates a board and links it to one or more projects
- **THEN** tasks can be created on that board scoped to any of the linked projects

#### Scenario: Board displays tasks from multiple projects
- **WHEN** a board is linked to multiple projects
- **THEN** task cards on the board display a project badge identifying which project each task belongs to

#### Scenario: Board project assignment updated from Setup UI
- **WHEN** the user edits a board in the Boards tab and changes the project checkbox selection
- **THEN** the board's projectKeys are updated and the task creation dialog reflects the new project options

### Requirement: Board uses a configurable workflow template
The system SHALL associate each board with a workflow template that defines its columns, column order, `on_enter_prompt`, and `stage_instructions`. Templates are defined in YAML configuration files. The template SHALL be changeable from the Setup UI; changing the template on a board with existing tasks SHALL show a non-blocking inline warning.

#### Scenario: Board renders columns from template
- **WHEN** a board is opened
- **THEN** the board displays columns in the order defined by its associated workflow template

#### Scenario: Invalid template blocks board display
- **WHEN** a board's associated workflow template YAML is missing or invalid
- **THEN** the board displays a configuration error instead of columns

#### Scenario: Workflow template changed from Setup UI
- **WHEN** the user edits a board's workflow template in the Boards tab and saves
- **THEN** the board's workflowTemplateId is updated and the board view reloads with the new column layout

#### Scenario: Inline warning shown when changing template on board with tasks
- **WHEN** the user selects a different workflow template for a board that has at least one task
- **THEN** an inline warning is shown in the dialog; the save button remains enabled
