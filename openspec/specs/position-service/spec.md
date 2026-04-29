## Purpose
TBD — provides a dedicated service for task position mutations, ensuring all position reordering operations are wrapped in database transactions.

## Requirements

### Requirement: PositionService wraps all task position mutations in transactions
The system SHALL provide a `PositionService` extracted from `tasks.ts` that wraps `rebalanceColumnPositions` and `reorderColumn` in `db.transaction()`. Individual UPDATE calls within these operations SHALL NOT be autocommit.

#### Scenario: Rebalance column runs as single transaction
- **WHEN** `PositionService.rebalanceColumnPositions(columnTasks)` is called
- **THEN** all position UPDATE statements execute within a single `db.transaction()` and produce exactly one WAL flush regardless of the number of tasks

#### Scenario: Reorder column runs as single transaction
- **WHEN** `PositionService.reorderColumn(boardId, columnId, taskId, newPosition)` is called
- **THEN** all affected position UPDATE statements execute within a single `db.transaction()`

#### Scenario: PositionService injected with Database
- **WHEN** `PositionService` is constructed
- **THEN** it receives a `Database` instance as a constructor argument and does not call `getDb()` internally
