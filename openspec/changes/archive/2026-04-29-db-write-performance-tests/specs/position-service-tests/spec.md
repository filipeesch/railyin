## ADDED Requirements

### Requirement: PS-1 Rebalance column positions in one transaction
`PositionService.rebalanceColumnPositions(boardId, columnId)` renumbers all tasks in the column with evenly spaced positions and wraps all UPDATEs in a single `db.transaction()`.

#### Scenario: All tasks renumbered atomically
- **GIVEN** 3 tasks with positions [1000, 2000, 3000]
- **WHEN** `rebalanceColumnPositions()` is called
- **THEN** all 3 tasks have new evenly-spaced positions in a single transaction

### Requirement: PS-2 Reorder task position
`PositionService.reorderColumn(taskId, newPosition)` updates the target task's position and rebalances affected tasks, all within one transaction.

#### Scenario: Task moved to new position
- **GIVEN** task A at position 1000, task B at 2000, task C at 3000
- **WHEN** task C is moved to position 500
- **THEN** task C has position 500 and relative order of A and B is preserved

### Requirement: PS-3 Transaction atomicity
If any UPDATE in a rebalance or reorder fails, no changes are committed.

#### Scenario: Partial failure rolls back
- **GIVEN** a constraint violation that would occur mid-rebalance
- **WHEN** the transaction encounters the violation
- **THEN** no position changes are persisted
