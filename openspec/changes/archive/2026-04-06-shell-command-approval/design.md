## Context

Railyin agents run autonomously and can call `run_command` at any time. The original defense was a `BLOCKED_COMMANDS` regex blocklist that rejected commands containing `>`, `tee`, `rm`, etc. That approach has two problems: it breaks legitimate commands (e.g. `git commit -m "message > with angle bracket"`) and it doesn't address the real danger — commands that reach outside the worktree (network, remote pushes, destructive deletions on arbitrary paths).

Tools like Copilot and Cursor handle this by presenting an approval prompt before running commands the user hasn't seen. Railyin's consent model mirrors that UX but scopes approval to the command binary (e.g. `git`, `bun`, `rm`), which gives users meaningful control without requiring them to approve every distinct invocation.

## Goals

- Replace the static `BLOCKED_COMMANDS` blocklist with a dynamic, per-task binary-level approval gate.
- Pause execution and show the full command + unapproved binaries before running anything not yet approved.
- Let users approve binaries for a single invocation (approve once) or permanently for the task lifetime (approve for task).
- Let users deny a command — the agent receives a tool error and continues reasoning.
- Provide an escape hatch: a per-task auto-approve toggle that bypasses all prompts.

## Non-Goals

- Approvals do not persist across tasks or across the workspace — they are task-scoped only.
- Approval state does not reset when a task changes columns (lifetime = task lifetime).
- No hierarchy of "safe" vs "dangerous" binaries — all unapproved binaries are treated equally.
- No global allowlist in `workspace.yaml` for this iteration.

## Decisions

### Binary extraction from compound commands

A command passed to `run_command` may be a compound shell expression: `cd src && git diff && bun test`. The extraction algorithm splits on the shell meta-characters `&&`, `||`, `|`, and `;`, then takes the first non-empty token of each segment as the binary name. Binaries are deduplicated before the approval check. This is done with a small pure function in `tools.ts`.

**Rationale:** Operating at binary granularity is coarse enough to be manageable (users approve `rm` once, not every individual `rm` invocation) while still being meaningful (a user who approved `git` doesn't implicitly approve `curl`).

### Single pause for all unapproved binaries

When a command contains multiple unapproved binaries, a single approval prompt is issued listing all of them together. The prompt shows the full raw command string and the deduplicated list of unapproved binaries. Options: `approve_once`, `approve_all`, `deny`.

**Rationale:** Chaining N prompts for N binaries would be disruptive and surprising. One consolidated pause is the clearest UX.

### Pause mechanism reuses ask_user_prompt

The approval pause writes an `ask_user_prompt`-type message to the conversation with a structured payload, sets `execution_state = 'waiting_user'`, and sends a `task.updated` event. The frontend renders it with a specialized approval UI (binary list + three action buttons) rather than the generic text input.

**Rationale:** Reusing the existing pause-and-resume path avoids a new execution control plane. The only new work is the frontend rendering of the approval payload.

### Approval response format

When the user responds, the frontend sends a human turn message with a structured payload indicating the choice. The engine intercepts this (same interception point as ask_me) and either stores approved binaries to the DB or returns a tool error before resuming the AI stream.

`approve_once`: No DB write. Approved binaries are held in memory for the duration of the current `run_command` call only.
`approve_all`: Appended to `tasks.approved_commands` JSON array in the DB and to the in-memory set for the current execution.
`deny`: Engine returns a tool error string to the agent; the agent continues its turn.

### Storage: JSON array on the task row

Approved binaries are stored as a JSON text column `tasks.approved_commands` (default `'[]'`). This avoids a separate join table for what is a simple ordered set of strings. The column is read once at the start of each tool call and the result is merged with an in-memory set held in the execution context.

### Auto-approve toggle

`tasks.shell_auto_approve INTEGER DEFAULT 0`. When `1`, the approval gate is skipped entirely and commands run immediately. Surfaced as a toggle in `TaskDetailDrawer.vue`.

**Rationale:** Power users running trusted agents should be able to opt out of per-command friction. Making it per-task (not global) keeps the default safe.

### BLOCKED_COMMANDS removed

The entire `BLOCKED_COMMANDS` regex and all enforcement logic in `tools.ts` is deleted. The approval gate replaces it functionally with a better UX and without false positives.

## Risks and Trade-offs

**Binary extraction is heuristic.** Complex shell expressions (heredocs, subshells, aliases) may not parse correctly. A command like `bash -c "rm -rf /"` would extract `bash` but not `rm`. Mitigant: this is the same limitation that Copilot/Cursor accept; the model is generally responsible for the commands it issues.

**In-memory approve_once state is lost if the process crashes.** This is acceptable: a crash means the task restarts and the user is prompted again — the safe default.

**Frontend approval UI is a new component.** The `ask_user_prompt` payload structure needs to be extended to include a type discriminant (`shell_approval`) so the frontend can render buttons instead of a text box. This is a small but real UI addition.
