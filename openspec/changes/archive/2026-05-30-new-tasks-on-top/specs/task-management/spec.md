## MODIFIED Requirements

### Requirement: New tasks are inserted at the top of the backlog column
The system SHALL insert newly created tasks at the **top** of the backlog column. The position assigned to the new task SHALL be `MIN(position) / 2` for the backlog column on the target board. When the backlog column has no existing tasks, the position SHALL be `500`. This applies to tasks created via the `tasks.create` RPC handler.

#### Scenario: New task appears above all existing tasks in backlog
- **WHEN** the backlog column contains tasks with positions `[1000, 2000, 3000]` and a new task is created
- **THEN** the new task is assigned position `500` (1000 / 2) and appears at the top of the backlog column

#### Scenario: New task in empty backlog receives position 500
- **WHEN** the backlog column is empty and a new task is created
- **THEN** the new task is assigned position `500`

#### Scenario: Board renders new task at the top
- **WHEN** a new task is created and the board reloads
- **THEN** the new task card appears as the first card in the backlog column
