## MODIFIED Requirements

### Requirement: BoardToolExecutor assigns top-of-column position on task creation
The system SHALL assign a top-of-column position to tasks created via `BoardToolExecutor.execCreateTask`. The position SHALL be computed using `PositionService.getTopPosition(boardId, 'backlog')` — returning `MIN(position) / 2` or `500` when the column is empty. The position SHALL be stored explicitly in the database; the behaviour MUST NOT rely on the DB column default (`0`).

#### Scenario: AI-created task appears at the top of the backlog column
- **WHEN** an AI agent invokes `execCreateTask` on a board whose backlog contains tasks with positions `[1000, 2000]`
- **THEN** the created task is assigned position `500` and appears at the top of the backlog column

#### Scenario: AI-created task in empty backlog receives position 500
- **WHEN** an AI agent invokes `execCreateTask` on a board with an empty backlog
- **THEN** the created task is assigned position `500`
