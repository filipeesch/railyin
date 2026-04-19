## ADDED Requirements

### Requirement: Card placed at top of target column on transition
When a task is moved to a different workflow column — via the Select dropdown in the Task Detail Drawer, or via the agent `move_task` tool — the task SHALL be placed at the top of the target column. The `position` value assigned SHALL be `MIN(existing_positions_in_target_column) / 2`, or `500` when the target column is empty.

#### Scenario: Card via Select lands at top of non-empty column
- **WHEN** a user selects a different column from the workflow Select in the Task Detail Drawer
- **THEN** the moved card appears above all existing cards in the target column

#### Scenario: Card via Select lands at top of empty column
- **WHEN** a user selects a column that currently has no cards
- **THEN** the moved card is the only card in that column and its position is set to `500`

#### Scenario: Agent move_task places card at top
- **WHEN** an AI agent calls `move_task` with a target workflow state
- **THEN** the task is placed at the top of the target column using the same halving formula

#### Scenario: tasks.transition RPC defaults to top when no position provided
- **WHEN** the `tasks.transition` RPC is called without a `targetPosition` parameter
- **THEN** the backend computes the top-of-column position and applies it automatically

#### Scenario: Drag-and-drop position behavior unchanged
- **WHEN** a user drags a card and drops it at a specific position in a column
- **THEN** the card lands at the exact dragged position (not necessarily the top), preserving existing drag-and-drop behavior
