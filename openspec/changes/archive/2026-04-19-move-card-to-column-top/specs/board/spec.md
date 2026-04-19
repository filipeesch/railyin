## MODIFIED Requirements

### Requirement: Board supports task transitions
The system SHALL allow a user to move a task from one workflow column to another by interacting with the board. The task's workflow state SHALL update immediately upon transition. When moved via the Select dropdown or agent `move_task` tool, the task SHALL appear at the **top** of the target column.

#### Scenario: Task moves to target column immediately
- **WHEN** a user moves a task to a different column
- **THEN** the task appears in the target column immediately and its `workflow_state` is updated

#### Scenario: Transition triggers execution
- **WHEN** a task is moved to a column that has an `on_enter_prompt` configured
- **THEN** a new execution is created and the prompt begins running after the task moves

#### Scenario: Task moved via Select appears at top of target column
- **WHEN** a user selects a different column from the workflow Select in the Task Detail Drawer
- **THEN** the task card is placed at the top of the target column, above all existing cards
