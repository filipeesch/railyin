## MODIFIED Requirements

### Requirement: ESP-1 `tasks.list` returns correct execution count
After the correlated subquery → `LEFT JOIN + GROUP BY` fix, `tasks.list` must return an accurate `executionCount` for each task.

#### Scenario: Task with N executions shows count N
- **GIVEN** a task with 3 executions
- **WHEN** `tasks.list` is called
- **THEN** the returned task has `executionCount = 3`

#### Scenario: Task with no executions shows count 0
- **GIVEN** a task with no executions
- **WHEN** `tasks.list` is called
- **THEN** the returned task has `executionCount = 0`

### Requirement: ESP-2 `tasks.delete` removes all related data atomically
After the transaction wrap, deleting a task must remove all 6 related tables' rows in one atomic operation.

#### Scenario: All related rows removed
- **GIVEN** a task with executions, messages, stream events, and raw messages
- **WHEN** `tasks.delete` is called
- **THEN** all related rows across all 6 tables are removed

#### Scenario: Partial failure rolls back entire delete
- **GIVEN** a delete operation that would violate a constraint mid-way
- **WHEN** the transaction encounters the violation
- **THEN** no rows are removed
