## MODIFIED Requirements

### Requirement: Backend rejects transitions that exceed column limit
Both the `tasks.transition` RPC and the `move_task` agent tool SHALL return an error when the target column already holds `limit` cards. No database write SHALL occur. Both paths SHALL use a shared `TransitionValidator` module that performs this check, ensuring workspace-config is resolved correctly for each board.

#### Scenario: tasks.transition RPC returns error at capacity
- **WHEN** `tasks.transition` is called with a `toState` whose column is at its limit
- **THEN** the RPC returns an error response and the task's `workflow_state` is unchanged

#### Scenario: move_task agent tool returns error at capacity
- **WHEN** an agent calls `move_task` with a target column that is at its limit
- **THEN** the tool returns a string error message explaining the limit was reached and the task is not moved

#### Scenario: Limit check is authoritative even if UI allows the move
- **WHEN** two concurrent requests both target a column with one free slot
- **THEN** exactly one succeeds; the other receives a limit-exceeded error and the column never exceeds its limit
