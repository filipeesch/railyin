## MODIFIED Requirements

### Requirement: A task and all associated data can be deleted
The system SHALL allow the user to delete a task. Deletion SHALL cascade to remove all related records and the worktree directory, while keeping the git branch.

#### Scenario: Confirmation required before deletion
- **WHEN** the user triggers delete on a task
- **THEN** a confirmation dialog is shown warning that the worktree and all chat history will be removed

#### Scenario: Running execution cancelled before deletion
- **WHEN** a task with `execution_state = 'running'` is deleted
- **THEN** the execution is cancelled first, then deletion proceeds

#### Scenario: Worktree directory removed on delete
- **WHEN** a task with a worktree at `worktree_path` is deleted
- **THEN** `git worktree remove --force <worktree_path>` is executed; failures are logged but do not block deletion

#### Scenario: Git branch kept on delete
- **WHEN** a task is deleted
- **THEN** the git branch associated with the task is NOT deleted

#### Scenario: All DB records removed on delete
- **WHEN** a task is deleted
- **THEN** its conversation messages, executions, git context, conversation, and task record are all removed from the database

#### Scenario: Task removed from board after deletion
- **WHEN** deletion completes
- **THEN** the task disappears from the board view and the task detail drawer closes

#### Scenario: Batch delete reuses single delete RPC
- **WHEN** the user deletes multiple selected cards from the board
- **THEN** the frontend SHALL call the existing `tasks.delete` RPC once per selected card
