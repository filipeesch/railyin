## Purpose
Defines how workflow columns can declare a maximum card capacity and how the UI and backend enforce that limit.

## Requirements

### Requirement: Columns may declare a card limit
A `WorkflowColumnConfig` SHALL accept an optional `limit` integer field. When absent or null the column is unlimited. When present it defines the maximum number of task cards allowed in that column at any time.

#### Scenario: Column without limit accepts any number of cards
- **WHEN** a column has no `limit` field
- **THEN** any number of cards can be moved into it without restriction

#### Scenario: Column with limit shows capacity badge
- **WHEN** a column has `limit: N` and currently holds M cards
- **THEN** the column header badge displays `M/N`

#### Scenario: Badge turns red when column is at capacity
- **WHEN** a column holds exactly `limit` cards
- **THEN** the badge renders in a red/error colour to signal no more cards are allowed

### Requirement: UI hard-blocks a drop into a column at capacity
When a user attempts to drag a card into a column that already holds `limit` cards, the drop SHALL be rejected in the UI without making any API call.

#### Scenario: Column at capacity rejects drag-drop
- **WHEN** the user drags a card over a column that is at its limit
- **THEN** the column shows a red dashed outline (full / blocked visual state) instead of the normal drag-over outline, and releasing the pointer does not move the card

#### Scenario: At-capacity column returns dragged card to origin
- **WHEN** the user releases a card over a column at capacity
- **THEN** the card returns to its original column and position with no visible transition

#### Scenario: Column one below limit accepts a drop normally
- **WHEN** a column holds `limit - 1` cards and the user drags a card into it
- **THEN** the drop succeeds and the card appears in the target column

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
