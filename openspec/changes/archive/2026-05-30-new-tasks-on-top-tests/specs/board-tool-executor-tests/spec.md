## ADDED Requirements

### Requirement: tasks.create integration position coverage
The `tasks.create` RPC handler position behaviour SHALL be covered by integration tests in suite `TC-POS` within `src/bun/test/handlers.test.ts`. Each test MUST use an in-memory DB via `initDb()` and assert both the handler response `position` field and the persisted DB row.

#### Scenario: TC-POS-1 — first task lands at 500
- **WHEN** `tasks.create` is called on an empty backlog
- **THEN** the returned task has `position === 500`
- **AND** the DB row for that task has `position = 500`

#### Scenario: TC-POS-2 — second task lands below first
- **WHEN** one task already exists in backlog at position `500`
- **AND** `tasks.create` is called again
- **THEN** the returned task has `position < 500`
- **AND** the new task's DB position is `250` (500 / 2)

#### Scenario: TC-POS-3 — third task lands below second
- **WHEN** two tasks exist in backlog at positions `250` and `500`
- **AND** `tasks.create` is called a third time
- **THEN** the returned task has `position < 250`
- **AND** the new task's DB position is `125` (250 / 2)

#### Scenario: TC-POS-4 — returned position matches DB
- **WHEN** `tasks.create` returns a task
- **THEN** the `position` field in the response MUST exactly equal the `position` column in the `tasks` DB row
