## Why

Railyin agents run autonomously in the background and can invoke arbitrary shell commands via `run_command` without user awareness. The current blunt blocklist prevents legitimate commands and gives misleading errors, while still not addressing the real risk: commands with side effects outside the worktree (network, remote git, etc.). A consent model — identical in spirit to Copilot/Cursor's auto-approve UX — gives users control without sacrificing capability.

## What Changes

- `run_command` no longer has a static blocklist. Every command passes through an approval gate.
- Before executing any `run_command`, the engine extracts the unique command binaries from the full command string and checks them against a per-task approved set.
- If all binaries are already approved (or `shell_auto_approve` is enabled), the command runs immediately.
- If any binary is not yet approved, execution pauses and an approval prompt is shown — displaying the **full command** and all unapproved binaries — with three options: **Approve once**, **Approve all for this task**, **Deny**.
- "Approve all for this task" stores the approved binaries in the task row; they persist across executions for the lifetime of the task.
- "Deny" returns a tool error to the agent and lets it continue.
- A per-task **Auto-approve** toggle in the task drawer bypasses all approval prompts when enabled.
- The existing `BLOCKED_COMMANDS` regex is removed entirely.

## Capabilities

### New Capabilities

- `shell-command-approval`: Per-task shell command consent model — binary-level approval tracking, pause-and-ask UX via the existing ask_user_prompt mechanism, approve-once vs. approve-for-task options, and a per-task auto-approve toggle.

### Modified Capabilities

- `workflow-engine`: `run_command` tool execution path changes — approval check inserted before `spawnSync`, approval state read/written from task row, denial returns tool error instead of blocking.
- `task`: Two new fields added to the `tasks` table — `shell_auto_approve` (boolean) and `approved_commands` (JSON array of binary names). Exposed in RPC types and task mapper.

## Impact

- `src/bun/db/migrations.ts` — new migration adding `shell_auto_approve` and `approved_commands` columns to `tasks`
- `src/bun/db/row-types.ts` — `TaskRow` extended with new fields
- `src/bun/db/mappers.ts` — `mapTask` extended to include new fields
- `src/shared/rpc-types.ts` — `Task` type extended
- `src/bun/workflow/tools.ts` — `BLOCKED_COMMANDS` removed; approval check injected into `run_command` case; new approval-pause path using engine callback
- `src/bun/workflow/engine.ts` — new engine callback for shell approval pause (similar to ask_me intercept); approval state read/write helpers
- `src/mainview/components/TaskDetailDrawer.vue` — auto-approve toggle in drawer UI
- `src/mainview/stores/task.ts` — expose `shellAutoApprove` and `approvedCommands` from task store
