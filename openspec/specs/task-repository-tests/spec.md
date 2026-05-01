## Purpose
Specifies unit test coverage for `TaskRepository`, ensuring the three `findById` paths are verified against a real in-memory SQLite database.

## Requirements

### Requirement: TaskRepository unit tests cover all findById paths
`src/bun/test/task-repository.test.ts` SHALL exist and cover the three `findById` paths using a real in-memory SQLite database seeded by `initDb()`.

#### Scenario: TR-1 — findById returns worktreePath when git context row exists
- **WHEN** a task row exists and a matching `task_git_context` row with `worktree_path = '/tmp/test'` exists
- **THEN** `taskRepository.findById(id)` returns a task with `worktreePath === '/tmp/test'`

#### Scenario: TR-2 — findById returns null worktreePath when no git context row
- **WHEN** a task row exists but no `task_git_context` row exists for it
- **THEN** `taskRepository.findById(id)` returns a task with `worktreePath === null`

#### Scenario: TR-3 — findById returns null for missing task
- **WHEN** no task row exists for the given ID
- **THEN** `taskRepository.findById(id)` returns `null`
