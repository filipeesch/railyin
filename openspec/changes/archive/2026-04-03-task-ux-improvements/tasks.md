## 1. DB Migration

- [x] 1.1 Add migration `002_task_ux_improvements`: add `model TEXT` column to `tasks`; add `cancelled` to the set of documented execution state values
- [x] 1.2 Update `TaskRow` type in `row-types.ts` to include `model: string | null`
- [x] 1.3 Update `mapTask` in `mappers.ts` to map `model`, `worktree_status`, `branch_name`, and `worktree_path` from a joined `task_git_context` row (update query in `tasks.list` to LEFT JOIN)
- [x] 1.4 Update `Task` in `rpc-types.ts` to add `model: string | null`, `worktreeStatus: string | null`, `branchName: string | null`, `worktreePath: string | null`
- [x] 1.5 Add `cancelled` to the `ExecutionState` union type in `rpc-types.ts`

## 2. Model Selection — Backend

- [x] 2.1 Add optional `model` field to `WorkflowColumn` type in `rpc-types.ts` and in the YAML config loader
- [x] 2.2 In `handleTransition` (engine.ts): resolve `column.model ?? workspace.model` and write it to `tasks.model` before starting the execution
- [x] 2.3 In `handleTransition` and `handleHumanTurn`: pass `task.model ?? workspace.model` to `createProvider()` instead of always using `workspace.model`
- [x] 2.4 Add `"models.list"` RPC handler: `GET {base_url}/v1/models`, return `string[]` of model IDs, return `[]` on any error
- [x] 2.5 Add `"tasks.setModel"` RPC handler: update `tasks.model` for a given taskId, return updated Task

## 3. Cancellation — Backend

- [x] 3.1 Create an in-memory `Map<number, AbortController>` (keyed by executionId) in the engine module
- [x] 3.2 In `handleTransition` and `handleHumanTurn`: register an AbortController at execution start; thread its signal into all AI provider calls (streaming and non-streaming fetch)
- [x] 3.3 Remove the AbortController from the map when any execution finishes (completed, failed, waiting_user, cancelled)
- [x] 3.4 In the engine's streaming/tool loop: catch `AbortError`; set `execution.status = 'cancelled'`; set `task.execution_state = 'waiting_user'`; call `onTaskUpdated`
- [x] 3.5 Add `"tasks.cancel"` RPC handler: look up `task.current_execution_id`, call `controller.abort()` on it; return updated Task
- [x] 3.6 Wire the AbortSignal into the OpenAI-compatible provider's `chat()` and `turn()` fetch calls

## 4. Task Management — Backend

- [x] 4.1 Add `removeWorktree(taskId)` to `worktree.ts`: run `git worktree remove --force` on the task's `worktree_path`; no-op if not created; log errors without throwing
- [x] 4.2 Add `"tasks.update"` RPC handler: update `title` and `description` for a given taskId; reject with error if `worktree_status` is not `not_created`; return updated Task
- [x] 4.3 Add `"tasks.delete"` RPC handler:
  - Cancel running execution if any (reuse AbortController logic from 3.5)
  - Call `removeWorktree(taskId)`
  - Delete in order: conversation_messages → executions → task_git_context → conversations → tasks
  - Return `{ success: true }`
- [x] 4.4 Add `"tasks.getGitStat"` RPC handler: run `git diff --stat HEAD` in `worktree_path`; return output string or `null` if worktree not ready

## 5. RPC Type Declarations

- [x] 5.1 Add `"models.list"`, `"tasks.setModel"`, `"tasks.cancel"`, `"tasks.update"`, `"tasks.delete"`, `"tasks.getGitStat"` to `RailynRPCType` in `rpc-types.ts`
- [x] 5.2 Register all new handlers in `index.ts` (Bun entrypoint)

## 6. Model Selection — Frontend

- [x] 6.1 Add `loadModels()` action to an appropriate store (or task store): call `models.list` RPC, store result; if empty, set `modelsUnavailable = true`
- [x] 6.2 Add model picker to `TaskDetailDrawer.vue` side panel: show `<Select>` dropdown when models list is non-empty; show read-only `<span>` with current model name when empty
- [x] 6.3 On model selection change: call `tasks.setModel` RPC; update the task in the store

## 7. Cancellation — Frontend

- [x] 7.1 Add Cancel button to `TaskDetailDrawer.vue` (visible only when `task.executionState === 'running'`)
- [x] 7.2 On cancel click: call `tasks.cancel` RPC; update task in store from response
- [x] 7.3 Add `cancelled` case to `execLabel` and `execSeverity` maps in `TaskCard.vue` and `TaskDetailDrawer.vue`

## 8. Task Management — Frontend

- [x] 8.1 Add an edit button (pencil icon) in `TaskDetailDrawer.vue` header: visible when `task.worktreeStatus === 'not_created'`; disabled with tooltip otherwise
- [x] 8.2 Create an inline edit form (or small dialog) for title and description; on save, call `tasks.update` RPC and update store
- [x] 8.3 Add a delete button in `TaskDetailDrawer.vue` (e.g., in a kebab menu or danger section at the bottom of the side panel)
- [x] 8.4 Show a confirmation dialog on delete: warn that worktree and all chat history will be removed; on confirm, call `tasks.delete` RPC
- [x] 8.5 On successful delete: close drawer, remove task from board store, show a brief success toast

## 9. Task Drawer Detail — Frontend

- [x] 9.1 Extend `TaskDetailDrawer.vue` side panel with: Branch, Worktree Path, Worktree Status sections (populated from `task.branchName`, `task.worktreePath`, `task.worktreeStatus`)
- [x] 9.2 On drawer open (when `task.worktreeStatus === 'ready'`): call `tasks.getGitStat` RPC and display the result in a preformatted block under a "Changes" section
- [x] 9.3 Display execution attempt count in the side panel (from `tasks.list` extended data or a separate count field on Task)
- [x] 9.4 Add execution count to `Task` type and populate it in the `tasks.list` query via `SELECT COUNT(*) FROM executions WHERE task_id`
