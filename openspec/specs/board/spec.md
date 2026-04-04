## Purpose
The board is the primary navigation surface. It organises tasks by workflow state and exposes transitions and high-level execution status at a glance.

## Requirements

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

### Requirement: Board drag-and-drop uses pointer events for cursor control
The system SHALL implement task card dragging using pointer events (not HTML5 Drag-and-Drop) so that the operating system DnD protocol is never invoked. During a drag, the cursor SHALL be `grabbing` and text selection SHALL be suppressed.

#### Scenario: Grabbing cursor shown while dragging
- **WHEN** a user presses and drags a task card beyond 5px of movement
- **THEN** the cursor changes to `grabbing` for the duration of the drag

#### Scenario: No text is selected while dragging
- **WHEN** a user begins pressing on a task card
- **THEN** text selection is immediately suppressed for the duration of the pointer gesture

#### Scenario: Card clone follows the cursor during drag
- **WHEN** a drag gesture is active
- **THEN** a cloned copy of the card element follows the cursor at the exact position where it was grabbed; the original card becomes transparent in place to preserve column layout

#### Scenario: Target column is highlighted during drag
- **WHEN** the cursor moves over a column while dragging a task card
- **THEN** that column gains a dashed outline to indicate it is the active drop target

#### Scenario: Task transitions on pointer release over a different column
- **WHEN** the user releases the pointer over a column different from the task's current column
- **THEN** the task transitions to that column

#### Scenario: Click is not fired after a drag
- **WHEN** the user drags and releases a task card
- **THEN** the task detail drawer does NOT open (click is suppressed within 200ms of drag end)
