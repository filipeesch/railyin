## ADDED Requirements

### Requirement: Shell command approval applies to Bash calls from subagents
The shell command approval gate SHALL apply to Bash tool calls originating from subagents spawned by the Claude engine, in addition to Bash calls from the parent agent. Subagent Bash calls SHALL consult the same `ShellApprovalRepository` with the same `shellScope` (task or chat) as the parent agent. The `shellAutoApprove` flag and `approvedCommands` list SHALL be respected identically for subagent Bash calls.

#### Scenario: Subagent Bash call with unapproved binary is gated
- **WHEN** a Claude subagent attempts to run a Bash command containing a binary not in `approvedCommands`
- **THEN** the engine emits a `shell_approval` event and waits for user input before allowing or denying execution

#### Scenario: Subagent Bash call respects shellAutoApprove
- **WHEN** the task's `shell_auto_approve = 1` and a subagent calls `Bash`
- **THEN** the command is allowed immediately without a `shell_approval` event

#### Scenario: Subagent approve_all decision updates the shared approved_commands
- **WHEN** a user responds to a subagent-triggered `shell_approval` prompt with `"approve_all"`
- **THEN** the newly approved binaries are written to the task's `approved_commands` and subsequent calls (from parent or subagent) to those binaries are auto-approved
