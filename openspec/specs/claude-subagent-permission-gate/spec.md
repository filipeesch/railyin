## Purpose

The Claude subagent permission gate specifies how Bash shell approval logic is encapsulated and applied to all tool calls — both in the parent agent context and in subagents spawned during the same query — via the Claude SDK's `PreToolUse` hook and `bypassPermissions` mode.

## Requirements

### Requirement: BashPermissionGate encapsulates Bash approval logic
The Bash shell approval logic SHALL be extracted from `DefaultClaudeSdkAdapter._run()` into a `BashPermissionGate` class (or equivalent named class) in `src/bun/engine/claude/`. `DefaultClaudeSdkAdapter` SHALL accept a `BashPermissionGate` instance via constructor injection alongside `ShellApprovalRepository`. The `PreToolUse` hook body SHALL delegate to `BashPermissionGate`, which remains independently unit-testable without any Claude SDK involvement.

#### Scenario: BashPermissionGate.evaluate — non-Bash tool is auto-allowed
- **WHEN** `BashPermissionGate.evaluate` is called with a non-Bash tool name (e.g., `"Read"`)
- **THEN** it returns a `permissionDecision: "allow"` result without consulting `ShellApprovalRepository` and without calling `waitForResume`

#### Scenario: BashPermissionGate.evaluate — Bash with shellAutoApprove=true is auto-allowed
- **WHEN** `BashPermissionGate.evaluate` is called with `tool="Bash"`, `command="rm -rf /tmp"`, and `shellAutoApprove=true`
- **THEN** it returns `permissionDecision: "allow"` without calling `waitForResume`

#### Scenario: BashPermissionGate.evaluate — Bash with approved binary is auto-allowed
- **WHEN** `BashPermissionGate.evaluate` is called with `tool="Bash"`, `command="git status"`, and `"git"` is in `approved_commands`
- **THEN** it returns `permissionDecision: "allow"` without calling `waitForResume`

#### Scenario: BashPermissionGate.evaluate — Bash with unapproved binary blocks and resolves allow
- **WHEN** `BashPermissionGate.evaluate` is called with `tool="Bash"`, `command="npm install"`, `"npm"` not in `approved_commands`, and the injected `waitForResume` resolves with decision `"allow"`
- **THEN** it calls `waitForResume` exactly once and returns `permissionDecision: "allow"`

#### Scenario: BashPermissionGate.evaluate — Bash with unapproved binary blocks and resolves deny
- **WHEN** `BashPermissionGate.evaluate` is called with `tool="Bash"`, `command="curl https://evil.com"`, and the injected `waitForResume` resolves with decision `"deny"`
- **THEN** it returns `permissionDecision: "deny"` with a non-empty `permissionDecisionReason`

#### Scenario: BashPermissionGate.evaluate — approve_all persists approved binaries
- **WHEN** `waitForResume` resolves with decision `"approve_all"` for a Bash command containing binary `"bun"`
- **THEN** `ShellApprovalRepository.appendApprovedCommands` is called with `"bun"` and subsequent identical calls return `permissionDecision: "allow"` without calling `waitForResume`

### Requirement: PreToolUse hook gates Bash calls for parent agent and all subagents
The Claude engine SHALL register a `PreToolUse` hook on every `sdk.query()` call. The hook SHALL fire for all tool calls in the parent agent context and in any subagent context spawned during that query. For non-Bash tools, the hook SHALL return `permissionDecision: "allow"` immediately. For Bash tool calls, the hook SHALL apply the same `shellAutoApprove` and `approvedCommands` approval logic that was previously applied via `canUseTool`, reading approval state from `ShellApprovalRepository` using the task or chat `shellScope` from the outer execution context.

#### Scenario: Non-Bash subagent tool call is auto-approved
- **WHEN** a subagent calls `Read`, `Glob`, `Grep`, or any non-Bash tool
- **THEN** the `PreToolUse` hook returns `permissionDecision: "allow"` immediately without consulting `ShellApprovalRepository`

#### Scenario: Subagent Bash call with shellAutoApprove is auto-approved
- **WHEN** the task has `shell_auto_approve = 1` and a subagent calls the `Bash` tool
- **THEN** the `PreToolUse` hook returns `permissionDecision: "allow"` without emitting a `shell_approval` event

#### Scenario: Subagent Bash call with approved binary is auto-approved
- **WHEN** the task's `approved_commands` contains `"git"` and a subagent calls `Bash` with command `"git status"`
- **THEN** the `PreToolUse` hook returns `permissionDecision: "allow"` without emitting a `shell_approval` event

#### Scenario: Subagent Bash call with unapproved binary triggers approval prompt
- **WHEN** a subagent calls `Bash` with command `"rm -rf /tmp/test"` and `"rm"` is not in `approved_commands`
- **THEN** the engine emits a `shell_approval` event, waits for user input, and returns `permissionDecision: "allow"` or `"deny"` based on the user's decision

#### Scenario: Subagent Bash approve_all persists to task approved_commands
- **WHEN** a user approves a subagent Bash call with decision `"approve_all"`
- **THEN** the newly approved binaries are appended to the task's `approved_commands` via `ShellApprovalRepository.appendApprovedCommands`

#### Scenario: canUseTool callback is absent — no stream error
- **WHEN** the Claude engine executes a query with no `canUseTool` callback registered
- **THEN** no "Tool permission request failed: Error: Stream closed" error is produced for any tool call

### Requirement: Claude engine uses bypassPermissions mode with PreToolUse as the sole gate
The Claude engine SHALL set `permissionMode: "bypassPermissions"` on every `sdk.query()` call. The `PreToolUse` hook SHALL be the only permission gate. The `canUseTool` callback SHALL NOT be registered.

#### Scenario: All non-Bash tools execute without permission prompts
- **WHEN** the parent agent calls `Read`, `Write`, `Edit`, `Glob`, `Grep`, or any MCP tool
- **THEN** the tool executes immediately — no permission prompt, no stream pause

#### Scenario: MCP railyin tools execute without permission prompts
- **WHEN** the agent calls any `mcp__railyin__*` tool
- **THEN** the tool executes immediately regardless of `allowedTools` entries
