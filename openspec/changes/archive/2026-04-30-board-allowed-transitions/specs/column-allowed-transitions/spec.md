## ADDED Requirements

### Requirement: Columns may declare an allowed-transitions list
A `WorkflowColumnConfig` SHALL accept an optional `allowed_transitions` field containing a list of column IDs. When the field is present and non-empty, a card in that column MAY only be moved to one of the listed target columns. When the field is absent or empty, all transitions from that column remain permitted (open/permissive default).

#### Scenario: Column without allowed_transitions accepts moves to any column
- **WHEN** a column has no `allowed_transitions` field
- **THEN** a card in that column can be moved to any other column without restriction

#### Scenario: Column with allowed_transitions restricts destination
- **WHEN** a column declares `allowed_transitions: [col-a, col-b]`
- **THEN** a card in that column can only be moved to `col-a` or `col-b`; attempts to move it elsewhere are rejected

#### Scenario: Same-column reorder is never forbidden
- **WHEN** a user reorders cards within the same column
- **THEN** the reorder succeeds regardless of the source column's `allowed_transitions` list

### Requirement: Backend enforces allowed_transitions in tasks.transition RPC
The `tasks.transition` RPC SHALL reject a transition when the source column has a non-empty `allowed_transitions` list and `toState` is not in that list. No database write SHALL occur.

#### Scenario: tasks.transition RPC rejects a forbidden transition
- **WHEN** `tasks.transition` is called with a `toState` that is not in the source column's `allowed_transitions` list
- **THEN** the RPC returns an error and the task's `workflow_state` is unchanged

#### Scenario: tasks.transition RPC accepts a permitted transition
- **WHEN** `tasks.transition` is called with a `toState` that IS in the source column's `allowed_transitions` list
- **THEN** the transition proceeds normally

#### Scenario: tasks.transition validates toState is a real column
- **WHEN** `tasks.transition` is called with a `toState` that does not exist in the workflow template
- **THEN** the RPC returns an error listing valid column IDs and no state change occurs

### Requirement: Backend enforces allowed_transitions in move_task agent tool
The `move_task` agent tool SHALL return an error string when the source column has a non-empty `allowed_transitions` list and `workflow_state` is not in that list. No database write SHALL occur.

#### Scenario: move_task returns error for forbidden transition
- **WHEN** an agent calls `move_task` with a `workflow_state` not in the source column's `allowed_transitions`
- **THEN** the tool returns a string error message explaining the transition is not allowed, and the task is not moved

#### Scenario: move_task succeeds for permitted transition
- **WHEN** an agent calls `move_task` with a `workflow_state` that IS in the source column's `allowed_transitions`
- **THEN** the tool executes the transition normally

### Requirement: WorkflowColumn RPC type exposes allowed_transitions to frontend
The `WorkflowColumn` type returned in the `boards.list` RPC response SHALL include an `allowedTransitions` field (camelCase) carrying the value from the YAML. When absent in YAML, the field SHALL be absent or undefined in the response.

#### Scenario: allowed_transitions flows through boards.list response
- **WHEN** a workflow YAML column declares `allowed_transitions: [col-a, col-b]`
- **THEN** the corresponding column in the `boards.list` response has `allowedTransitions: ["col-a", "col-b"]`

#### Scenario: Column without allowed_transitions has no field in response
- **WHEN** a workflow YAML column has no `allowed_transitions` field
- **THEN** the corresponding column in the `boards.list` response has `allowedTransitions` absent or undefined

### Requirement: Board UI dims forbidden drop targets during drag
When a user begins dragging a card, columns that are not reachable from the card's current column (based on `allowedTransitions`) SHALL receive a `is-drag-forbidden` visual state. The drag cursor SHALL change to `not-allowed` when hovering over a forbidden column.

#### Scenario: Forbidden columns are dimmed immediately on drag start
- **WHEN** a user starts dragging a card from a column that has `allowedTransitions` defined
- **THEN** all columns NOT in the allowed list (and not the source column itself) immediately receive a dimmed/forbidden appearance

#### Scenario: No columns are dimmed when source has no allowedTransitions
- **WHEN** a user starts dragging a card from a column with no `allowedTransitions`
- **THEN** no columns are dimmed — all columns remain visually accepting

#### Scenario: Dropping on a forbidden column is silently rejected
- **WHEN** a user releases a card over a column in the forbidden set
- **THEN** the card returns to its original column and position with no API call made

#### Scenario: Cursor shows not-allowed over forbidden column
- **WHEN** a user is dragging a card and moves the pointer over a forbidden column
- **THEN** the cursor changes to `not-allowed`
