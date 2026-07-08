## ADDED Requirements

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

---

## Test Coverage

### Unit tests — `BashPermissionGate` (new file: `src/bun/test/bash-permission-gate.test.ts`)
Pure class tests. No Claude SDK, no in-memory DB. All dependencies injected.

| ID | Scenario | Method |
|----|---|---|
| BPG-1 | Non-Bash tool returns `allow` immediately | `evaluate("Read", ...)` |
| BPG-2 | Bash + `shellAutoApprove=true` → `allow` without `waitForResume` | `evaluate("Bash", ...)` |
| BPG-3 | Bash + binary in `approved_commands` → `allow` without `waitForResume` | `evaluate("Bash", ...)` |
| BPG-4 | Bash + unapproved binary → `waitForResume` called once → `allow` | `evaluate("Bash", ...)` |
| BPG-5 | Bash + unapproved binary → `waitForResume` resolves deny → `deny` with reason | `evaluate("Bash", ...)` |
| BPG-6 | `approve_all` → `appendApprovedCommands` called; next call auto-allows | `evaluate("Bash", ...)` x2 |

### Unit tests — `claude-adapter.test.ts` (update existing)
The existing `buildAllowPermissionResult` tests must be updated to assert the new `PreToolUse` hook-compatible return shape:
```ts
// NEW expected shape:
{ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: input } }
```

Note: the legacy `suggestions` / `updatedPermissions` parameter is NOT carried forward — the PreToolUse hook format does not include `updatedPermissions`. The parameter is accepted but ignored.

| ID | Scenario |
|----|---|
| CA-1 | `buildAllowPermissionResult(input)` → hook shape with `permissionDecision: "allow"` and `updatedInput` |
| CA-2 | `buildAllowPermissionResult(input, suggestions)` → same hook shape; legacy suggestions parameter is silently ignored |
| CA-3 | `getUnapprovedShellBinaries` — filters unapproved binaries correctly (unchanged helper) |

### Integration tests — `claude-rpc-scenarios.test.ts` (new cases alongside existing)
Using `MockClaudeSdkAdapter` + `BackendRpcRuntime`. Requires two new mock step kinds: `subagent_start` and `subagent_stop`.

| ID | Scenario |
|----|---|
| CRS-SA-1 | Subagent lifecycle (start → non-Bash tool → stop) completes end-to-end without shell_approval pause |
| CRS-SA-2 | Subagent Bash with unapproved binary → `shell_approval` message emitted → user approves → execution continues |
| CRS-SA-3 | `subagent_start` mock step → DB stream event `type=tool_call` with correct `subagentId` persisted |
| CRS-SA-4 | `subagent_stop` mock step → DB stream event `type=tool_result` with matching `blockId` persisted |
