## MODIFIED Requirements

### Requirement: Card placed at top of target column on transition
When a task is moved to a different workflow column — via the Select dropdown in the Task Detail Drawer, or via the agent `move_task` tool — the task SHALL be placed at the top of the target column. The `position` value assigned SHALL be `MIN(existing_positions_in_target_column) / 2`, or `500` when the target column is empty. After any position write, if the minimum gap between any two adjacent positions in the column drops below `1.0`, the backend SHALL rebalance all positions in that column to integer multiples of `1000` (e.g. `1000, 2000, 3000, …`) in current sort order.

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

#### Scenario: Positions are rebalanced when gap collapses
- **WHEN** repeated top-inserts cause the minimum gap between adjacent positions to fall below `1.0`
- **THEN** the backend rewrites all positions in that column as `1000, 2000, 3000, …` preserving their current order, so future inserts have full float headroom

## ADDED Requirements

### Requirement: Drag-and-drop is optimistic — ghost removed immediately on drop
When a user releases a dragged card, the ghost element and source card opacity SHALL be restored immediately (synchronously), before the `tasks.transition` API call resolves. If the API call fails, the card SHALL revert to its original column and position.

#### Scenario: Ghost disappears instantly on drop
- **WHEN** the user releases a dragged card over a valid target column
- **THEN** the ghost element is removed and the source card opacity is restored within the same event tick, with no visible delay

#### Scenario: Card reverts on API error
- **WHEN** the `tasks.transition` API call fails after an optimistic drop
- **THEN** the card reappears in its original column at its original position
