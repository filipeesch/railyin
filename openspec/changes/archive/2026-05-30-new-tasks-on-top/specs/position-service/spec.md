## ADDED Requirements

### Requirement: PositionService exposes a getTopPosition method
The system SHALL provide a `getTopPosition(boardId: number, columnId: string): number` method on `PositionService` that returns the position value to use when prepending a task to a column. The method SHALL query `MIN(position)` for tasks in that board column and return `MIN / 2`. When the column has no tasks, it SHALL return `500`.

#### Scenario: Returns half of current minimum when column is non-empty
- **WHEN** `PositionService.getTopPosition(boardId, columnId)` is called for a column containing at least one task with the current minimum position of `1000`
- **THEN** the method returns `500`

#### Scenario: Returns 500 when column is empty
- **WHEN** `PositionService.getTopPosition(boardId, columnId)` is called for a column with no tasks
- **THEN** the method returns `500`

#### Scenario: Returns half of minimum regardless of number of tasks
- **WHEN** the column contains tasks with positions `[2000, 4000, 8000]`
- **THEN** `getTopPosition` returns `1000` (2000 / 2)
