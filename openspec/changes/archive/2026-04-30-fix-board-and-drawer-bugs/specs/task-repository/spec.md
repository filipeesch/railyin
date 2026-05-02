## ADDED Requirements

### Requirement: TaskRepository provides a unified task read with git context
The system SHALL have a `TaskRepository` class in `src/bun/db/task-repository.ts` that exposes a `findById(id: number): Task | null` method. This method SHALL query tasks with a LEFT JOIN on `task_git_context` so that `worktree_path` and related git fields are always present when the row exists.

#### Scenario: findById returns task with worktree_path when git context exists
- **WHEN** `TaskRepository.findById(id)` is called for a task that has a `task_git_context` row
- **THEN** the returned `Task` has a non-null `worktreePath`

#### Scenario: findById returns task with null worktree fields when no git context
- **WHEN** `TaskRepository.findById(id)` is called for a task with no `task_git_context` row
- **THEN** the returned `Task` has `worktreePath` as null but is otherwise complete

#### Scenario: findById returns null for non-existent task
- **WHEN** `TaskRepository.findById(id)` is called with an ID that does not exist
- **THEN** the method returns null

### Requirement: Engine layer uses TaskRepository for post-execution task reads
All reads of a task object within the engine layer — including `stream-processor.ts` `finally` block and the `task_updated` event handler — SHALL use `TaskRepository.findById` instead of bare `SELECT * FROM tasks WHERE id = ?` queries.

#### Scenario: Post-execution WebSocket push carries worktree_path
- **WHEN** an execution completes and `stream-processor.ts` emits a `task.updated` WebSocket event
- **THEN** the pushed task object has the correct `worktreePath` value from the database
