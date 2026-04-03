## Why

The task board and chat interface lack several key interaction capabilities that force users to work around the tool rather than with it: there is no way to select which AI model drives a task, no way to cancel a running execution, no way to edit or delete tasks, and the task drawer surfaces almost no contextual information about the underlying git work.

## What Changes

- **Model selection**: Users can pick the active AI model from the chat window; the selection persists on the task and resets to the column default when the task transitions to a new column. Column defaults are configured per-column in the workflow YAML.
- **Edit task**: Task title and description are editable while no worktree has been created yet; locked thereafter to preserve git branch consistency.
- **Delete task**: A task (and all its associated data — conversation history, messages, executions, git context) can be deleted. The git branch is kept; only the worktree is removed. If an execution is running it is cancelled first.
- **Cancel execution**: A running execution can be cancelled. The produced partial messages and any worktree file changes are kept. The task returns to `waiting_user` so the user can send a new message to continue.
- **Task drawer info**: The drawer surfaces additional contextual data: worktree status, branch name, worktree path, git diff stat, and total execution attempt count.

## Capabilities

### New Capabilities
- `model-selection`: Per-task model override with column-level and workspace-level defaults; dynamic model list fetched from the provider's `/v1/models` endpoint with graceful fallback.
- `cancel-execution`: Ability to cancel an in-progress AI execution, marking it `cancelled`, keeping partial conversation state and worktree changes, and returning the task to `waiting_user`.
- `task-management`: Edit (title/description when worktree not yet created) and delete (cascade: messages, executions, git context, worktree removal) operations on tasks.
- `task-detail`: Richer task drawer showing worktree/branch info, git diff stat, and execution attempt count.

### Modified Capabilities
- `task`: Adds `model` field to the task record; adds `cancelled` as a valid `ExecutionState`.
- `workflow-engine`: Engine must honour the task-level model override; must support abort-signal-based cancellation.
- `ai-provider`: Provider factory must accept a model override; `models.list` endpoint added.
- `git-worktree`: Needs a `removeWorktree` function callable during task deletion.
- `conversation`: No requirement changes — conversation messages are now also surfaced via a git-stat RPC but the spec itself is unchanged.

## Impact

- **DB**: Migration adding `model TEXT` to `tasks`; `cancelled` added to execution status values.
- **Workflow YAML**: New optional `model` field per column (e.g. `delivery.yaml`).
- **RPC layer**: New endpoints — `models.list`, `tasks.cancel`, `tasks.delete`, `tasks.update`, `tasks.getGitStat`.
- **Engine**: `handleHumanTurn` / `handleTransition` must thread an `AbortSignal`; model resolution logic added.
- **Frontend**: Cancel button in drawer, model picker dropdown (hidden when `/v1/models` unavailable), delete+edit task actions, expanded side panel.
