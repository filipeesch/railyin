## REMOVED Requirements

### Requirement: run_command blocks shell write redirection
**Reason**: The static blocklist approach causes false positives (e.g. `>` inside git commit message strings) and does not address the actual risk of commands with side effects outside the worktree. Replaced by the binary-level shell command approval gate defined in the `shell-command-approval` capability.
**Migration**: The `BLOCKED_COMMANDS` regex and all enforcement logic in `tools.ts` are deleted. Commands that previously would have been rejected will instead trigger an approval prompt if the binary has not yet been approved for the task.

#### Scenario: Redirect operator is blocked
- **WHEN** an agent calls `run_command` with a command containing `>`
- **THEN** the tool returns an error and no file is written

#### Scenario: tee command is blocked
- **WHEN** an agent calls `run_command` with a command containing `tee`
- **THEN** the tool returns an error and no file is written

## MODIFIED Requirements

### Requirement: run_command executes a shell command in the worktree
The system SHALL execute a shell command in the task's worktree via `run_command`. Before spawning the subprocess, the engine SHALL check the command against the task's shell approval state (see `shell-command-approval` capability). If `shell_auto_approve` is `true` on the task, the check is skipped. If all extracted binaries are in the approved set, the command runs immediately. If any binary is unapproved, execution pauses until the user responds to an approval prompt. On `approve_once` or `approve_all`, the command proceeds. On `deny`, the tool returns a tool error and no subprocess is spawned.

#### Scenario: Approved command runs in worktree
- **WHEN** all binaries in a `run_command` call are in the task's approved set
- **THEN** the command is spawned with `cwd` set to the task's worktree path and its stdout/stderr is returned as the tool result

#### Scenario: Auto-approve bypasses gate
- **WHEN** `shell_auto_approve` is `true` on the task
- **THEN** `run_command` spawns the subprocess immediately without any approval check

#### Scenario: Unapproved binary pauses execution
- **WHEN** a `run_command` call contains a binary not in the approved set and `shell_auto_approve` is `false`
- **THEN** execution is suspended and an approval prompt is issued before any subprocess is spawned

#### Scenario: Denied command returns tool error
- **WHEN** the user denies an approval prompt for a `run_command`
- **THEN** the tool returns an error string and no subprocess is spawned
