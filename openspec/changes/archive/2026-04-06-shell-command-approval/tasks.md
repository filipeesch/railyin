## 1. Database Migration and Types

- [x] 1.1 Add migration in `src/bun/db/migrations.ts` adding `shell_auto_approve INTEGER DEFAULT 0` and `approved_commands TEXT DEFAULT '[]'` columns to the `tasks` table
- [x] 1.2 Extend `TaskRow` in `src/bun/db/row-types.ts` with `shell_auto_approve: number` and `approved_commands: string`
- [x] 1.3 Update `mapTask` in `src/bun/db/mappers.ts` to map `shell_auto_approve` (to boolean) and `approved_commands` (JSON.parse to string array) onto the domain `Task` object
- [x] 1.4 Extend the `Task` type in `src/shared/rpc-types.ts` with `shellAutoApprove: boolean` and `approvedCommands: string[]`

## 2. Binary Extractor Utility

- [x] 2.1 Implement `extractCommandBinaries(command: string): string[]` in `src/bun/workflow/tools.ts` — splits on `&&`, `||`, `|`, `;`, takes first non-empty token of each segment, deduplicates

## 3. Engine Approval Callback

- [x] 3.1 Define `OnShellApprovalRequest` callback type in `src/bun/workflow/engine.ts` with signature `(taskId: number, command: string, unapprovedBinaries: string[]) => Promise<'approve_once' | 'approve_all' | 'deny'>`
- [x] 3.2 Add approval state helpers in `engine.ts`: `getApprovedCommands(taskId)` (reads `approved_commands` from DB), `appendApprovedCommands(taskId, binaries)` (appends binaries to `approved_commands` JSON array in DB)
- [x] 3.3 Implement the approval pause flow in `engine.ts`: write `ask_user_prompt` message with `subtype: "shell_approval"` + full command + unapproved binaries, set `execution_state = 'waiting_user'`, emit `task.updated`, then wait for the user's structured response via the existing ask_me interception path
- [x] 3.4 On resume: intercept the structured response (`approve_once` / `approve_all` / `deny`), call `appendApprovedCommands` for `approve_all`, return the decision to the caller in `tools.ts`

## 4. Approval Gate in run_command

- [x] 4.1 Remove the `BLOCKED_COMMANDS` regex constant and all enforcement logic from `src/bun/workflow/tools.ts`
- [x] 4.2 Inject the approval gate into the `run_command` handler in `tools.ts`: read `shell_auto_approve` from task row; if true, skip gate; otherwise extract binaries, compute unapproved set, and call the engine's `OnShellApprovalRequest` callback
- [x] 4.3 On `approve_once`: proceed with subprocess spawn (no DB write)
- [x] 4.4 On `approve_all`: call `appendApprovedCommands`, then proceed with subprocess spawn
- [x] 4.5 On `deny`: return tool error string `"Command denied by user: <command>"` without spawning subprocess

## 5. Frontend: Task Store and Drawer UI

- [x] 5.1 Expose `shellAutoApprove` and `approvedCommands` from the task store in `src/mainview/stores/task.ts`
- [x] 5.2 Add an auto-approve toggle to `src/mainview/components/TaskDetailDrawer.vue` that reads and updates `shell_auto_approve` on the task via an RPC call
- [x] 5.3 Add a new approval prompt rendering branch in the chat message component: when a message has `type = "ask_user_prompt"` and `subtype = "shell_approval"`, render the full command string, the list of unapproved binaries, and three action buttons: "Approve once", "Approve for task", "Deny"
- [x] 5.4 Wire each button to send the appropriate structured response payload (`approve_once` / `approve_all` / `deny`) as a human turn message via the existing chat send path
