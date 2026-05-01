## ADDED Requirements

### Requirement: Drawer column-select shows only permitted transition targets
The task drawer's workflow-state select control SHALL display only the columns that are valid transition targets from the task's current column, using the same `allowedTransitions` data already available from the `boards.list` response. When the current column has no `allowedTransitions`, all columns remain selectable.

#### Scenario: Drawer select omits forbidden columns
- **WHEN** the task drawer is open and the current column declares `allowedTransitions: [col-a, col-b]`
- **THEN** the column-select shows only `col-a` and `col-b` as options, not the full column list

#### Scenario: Drawer select shows all columns when no allowedTransitions
- **WHEN** the task drawer is open and the current column has no `allowedTransitions`
- **THEN** the column-select shows all board columns as valid transition targets

#### Scenario: Drawer select filtering is consistent with board drag enforcement
- **WHEN** dragging a card on the board would forbid moving to column X
- **THEN** the drawer's column-select also does not offer column X as an option
