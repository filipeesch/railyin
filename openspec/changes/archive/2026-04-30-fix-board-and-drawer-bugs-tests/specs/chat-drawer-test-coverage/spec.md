## ADDED Requirements

### Requirement: Column select in drawer respects allowedTransitions
`e2e/ui/task-toolbar.spec.ts` SHALL include TT-12 and TT-13 verifying that the workflow-state select in the task drawer is filtered when `allowedTransitions` is set on the source column, and shows all columns when it is not.

#### Scenario: TT-12 — select shows only permitted targets when allowedTransitions set
- **WHEN** the task's current column declares `allowedTransitions: ['plan']`
- **AND** the user opens the workflow select in the task drawer
- **THEN** only the `plan` column option is present and other columns are absent

#### Scenario: TT-13 — select shows all columns when no allowedTransitions set
- **WHEN** the task's current column has no `allowedTransitions` field
- **AND** the user opens the workflow select in the task drawer
- **THEN** all workflow columns are present as options

### Requirement: Terminal button survives a task.updated push that preserves worktreePath
`e2e/ui/task-toolbar.spec.ts` SHALL include TT-14 verifying that the terminal launch button remains visible after a `task.updated` WebSocket push that includes the task's `worktreePath`.

#### Scenario: TT-14 — terminal button still visible after task.updated push with worktreePath
- **WHEN** a task has `worktreePath` set and the drawer is open
- **AND** a `task.updated` WS push arrives with the same task including a non-null `worktreePath`
- **THEN** the terminal launch button is still visible in the toolbar
