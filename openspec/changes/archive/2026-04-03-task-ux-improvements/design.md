## Context

Railyin currently has a single global AI model configured in `workspace.yaml`. The workflow engine has no cancellation mechanism — once an execution starts, it runs to completion or failure. The task board has no edit or delete operations. The task detail drawer shows only workflow state, execution state, and retry count in its side panel. The `task_git_context` table already stores `branch_name`, `worktree_path`, and `worktree_status` but none of this is surfaced in the UI.

## Goals / Non-Goals

**Goals:**
- Allow users to select the AI model from the task drawer; persist the choice on the task; reset to column default on column transition
- Allow users to cancel a running execution; keep partial conversation and worktree state; return task to `waiting_user`
- Allow users to edit task title/description when no worktree has been created yet; lock editing once the worktree exists
- Allow users to delete a task including a full cascade (messages, executions, git context, worktree removal); keep the git branch
- Surface branch name, worktree path, worktree status, git diff stat, and execution count in the task drawer

**Non-Goals:**
- Column model editing via UI (YAML-only for now)
- Branch renaming on task title edit
- Rename/merge conversation history on edit
- Real-time live polling of git diff in the drawer
- Mid-stream token cancellation (cancellation fires between AI turns, not mid-token)

## Decisions

### D1 — Model stored on the task, reset on transition

The `tasks` table gains a `model TEXT` column (nullable = use workspace default). When a task transitions to a new column, the engine resolves: `column.model ?? workspace.model` and writes it back to `tasks.model`. The UI reads `task.model` to initialise the picker.

**Alternative considered**: store model only in the execution record. Rejected — the user needs a persistent override that survives across executions within the same column stay.

### D2 — Model list from `/v1/models`; fall back to label

The Bun process calls `GET {base_url}/v1/models` (same base URL as configured, with the configured API key). If the call succeeds, the list of model IDs is returned via a new `models.list` RPC. If it fails (network error, 404, non-JSON), the RPC returns an empty array. The frontend hides the dropdown and shows a plain label with the current model when the list is empty.

**Alternative considered**: cache the model list in a DB table. Rejected — it adds complexity for low value; network latency is acceptable on drawer open.

### D3 — Cancellation via in-memory AbortController map

The engine module maintains a `Map<executionId, AbortController>`. On `tasks.cancel`, the handler looks up `task.current_execution_id`, calls `controller.abort()`, and the engine's AI call propagates the signal to the fetch request. The engine catches `AbortError`, writes `execution.status = 'cancelled'`, and sets `task.execution_state = 'waiting_user'`. All conversation messages produced so far (including partial tool calls) are kept. All worktree file writes that already happened are kept.

**Cancellation granularity**: Between AI turns (non-streaming tool rounds). The abort signal is also threaded into the streaming fetch for the final text turn, so mid-stream cancellation also works if the HTTP client supports it (LM Studio / OpenRouter both do via fetch abort).

**Alternative considered**: persistent cancellation flag in DB. Rejected — the engine already runs in-process; an in-memory signal is simpler and faster.

### D4 — `cancelled` added as a valid ExecutionState

`ExecutionState` gains a `cancelled` variant. This is stored in `executions.status` and can appear in `task.execution_state` transiently before the task returns to `waiting_user`. The board card shows `cancelled` as a secondary badge.

### D5 — Edit locked once worktree exists

A task's title and description are editable only while `task_git_context.worktree_status = 'not_created'`. The frontend checks `task.worktreeStatus` (surfaced through a new `tasks.getDetail` RPC or by extending `Task` with git context). A padlock icon indicates why editing is disabled.

**Alternative considered**: always allow edit, hide branch divergence. Rejected — silent divergence between task title and branch name is confusing.

### D6 — Delete cascade: worktree removed, branch kept

Deletion order:
1. Cancel any running execution (via the AbortController map)
2. `git worktree remove --force <worktree_path>` (no-op if not created)
3. DELETE conversation_messages WHERE task_id
4. DELETE executions WHERE task_id
5. DELETE task_git_context WHERE task_id
6. DELETE conversations WHERE task_id
7. DELETE tasks WHERE id

The git branch is left intact. If the worktree removal fails (e.g. directory already gone), the error is logged but deletion continues.

### D7 — Git diff stat on demand via new RPC

A new `tasks.getGitStat` RPC runs `git diff --stat HEAD` in the worktree directory and returns the output as a string. Called once when the drawer opens (not polled). Returns `null` if the worktree is not ready.

### D8 — Task extended with git context and execution count

`Task` in `rpc-types.ts` gains optional fields: `model`, `worktreeStatus`, `branchName`, `worktreePath`. These are populated from `task_git_context` in `mapTask`. A new `tasks.getDetail` RPC (or an extended `tasks.list`) returns these fields. The drawer side panel uses them directly.

Execution attempt count comes from `SELECT COUNT(*) FROM executions WHERE task_id = ?` — cheap query, included in the same RPC.

## Risks / Trade-offs

- **AbortController lost on restart**: If the Bun process crashes while an execution is running, the in-memory AbortController is gone. On next start the task will still have `execution_state = 'running'` in the DB. Mitigation: on startup, any task with `execution_state = 'running'` is reset to `failed` (this is existing behaviour from the initial design; cancellation doesn't change it).

- **Partial AI response in conversation**: A cancelled execution may leave an incomplete assistant message in the conversation. This is intentional (Option C). The UI may want to visually mark cancelled assistant messages. Low risk — the user can read the partial and decide what to do.

- **git worktree remove on delete**: If the worktree path has uncommitted changes, `git worktree remove` without `--force` would fail. We use `--force` unconditionally. Risk: user loses uncommitted work if they delete a task by mistake. Mitigation: the confirmation dialog warns "This will remove the worktree and any uncommitted changes."

- **models.list latency**: First call on drawer open may be slow (100–500ms depending on local provider). Mitigation: show a loading spinner in the model picker while the list loads.
