## ADDED Requirements

### Requirement: getTopPosition unit coverage
`PositionService.getTopPosition` SHALL be covered by unit tests in suite `PS-4` within `src/bun/test/position-service.test.ts`. Each test MUST use an isolated in-memory SQLite database created via `initDb()`.

#### Scenario: PS-4.1 — non-empty column returns MIN/2
- **WHEN** a column contains tasks at positions `[500, 1000, 2000]`
- **THEN** `getTopPosition` returns `250` (500 / 2)

#### Scenario: PS-4.2 — empty column returns 500
- **WHEN** no tasks exist in the target column
- **THEN** `getTopPosition` returns `500`

#### Scenario: PS-4.3 — single task returns its position/2
- **WHEN** a column contains exactly one task at position `300`
- **THEN** `getTopPosition` returns `150`

#### Scenario: PS-4.4 — cross-board isolation
- **WHEN** board A has a task at position `100` in backlog and board B has a task at position `1000` in backlog
- **THEN** `getTopPosition(boardB, 'backlog')` returns `500` (computed from board B's min only)
