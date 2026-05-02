## ADDED Requirements

### Requirement: Terminal and code-server buttons persist after execution completes
The task drawer's terminal launch button and code-server launch button SHALL remain visible after an AI execution completes, provided the task has a linked worktree. A post-execution DB read that lacks the `task_git_context` JOIN SHALL NOT overwrite the `worktreePath` field with null.

#### Scenario: Terminal button visible after execution completes
- **WHEN** an execution finishes and the `task.updated` WebSocket event is received by the frontend
- **THEN** the terminal launch button remains visible if the task had a worktree before the execution

#### Scenario: Code-server button visible after execution completes
- **WHEN** an execution finishes and the `task.updated` WebSocket event is received by the frontend
- **THEN** the code-server launch button remains visible if the task had a worktree before the execution

#### Scenario: Buttons absent when task has no worktree
- **WHEN** a task has no associated worktree
- **THEN** neither the terminal nor the code-server launch button is shown, regardless of execution state
