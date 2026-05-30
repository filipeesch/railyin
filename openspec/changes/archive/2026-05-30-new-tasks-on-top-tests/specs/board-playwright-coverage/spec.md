## ADDED Requirements

### Requirement: execCreateTask integration position coverage
`BoardToolExecutor.execCreateTask` position behaviour SHALL be covered by integration tests extending the existing `BE-4` suite in `src/bun/test/board-tool-executor.test.ts`. Tests MUST use an isolated in-memory DB with DI (passing `db` to `BoardToolExecutor` constructor).

#### Scenario: BE-4.2 — execCreateTask places task above existing tasks
- **WHEN** backlog already contains a task at position `500`
- **AND** `execCreateTask` is called
- **THEN** the newly created task has `position < 500`

#### Scenario: BE-4.3 — execCreateTask on empty backlog uses 500
- **WHEN** backlog contains no tasks
- **AND** `execCreateTask` is called
- **THEN** the newly created task has `position === 500`

### Requirement: board-create-task Playwright coverage
The board creation Playwright suite SHALL cover card DOM ordering after a new task is created, in `e2e/ui/board-create-task.spec.ts`.

#### Scenario: CREATE-4 — newly created task card appears first
- **WHEN** the board has existing task cards
- **AND** the user creates a new task via the UI
- **AND** `tasks.create` is intercepted to return a task with a position lower than all existing tasks
- **THEN** the new task card MUST appear first among `.task-card` elements in the backlog column

#### Scenario: CREATE-5 — AI-created task pushed via WebSocket appears first
- **WHEN** the board has existing task cards (e.g., position `1000`)
- **AND** a `task.updated` WebSocket event arrives with a task at position `0.5`
- **THEN** the card for that task MUST appear first among `.task-card` elements in the backlog column
