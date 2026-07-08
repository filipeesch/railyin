## Context

The Claude Agent SDK v0.3.x introduced background subagents as the default execution model. When Claude calls the `Agent` tool, the subagent runs in a separate session context. The SDK's `canUseTool` callback is only registered on the parent query — subagent sessions have no callback, so any tool call from within a subagent triggers the SDK's internal permission channel, which immediately closes with "Error: Stream closed" since no one is listening.

The fix replaces the `canUseTool` callback with a `PreToolUse` hook. Unlike `canUseTool`, hooks propagate to all subagent contexts spawned from the same query. Combined with `permissionMode: "bypassPermissions"`, the PreToolUse hook becomes the single, explicit gate for all Bash calls — in both the parent agent and any subagents.

Current state in `DefaultClaudeSdkAdapter._run()`:
- `canUseTool` callback handles all Bash approvals for the parent agent only
- Subagents have no permission gate → stream closes → tool error
- `shellAutoApprove` / `approvedCommands` logic only runs for parent agent

## Goals / Non-Goals

**Goals:**
- Fix "Tool permission request failed: Error: Stream closed" for all subagent tool calls
- Propagate `shellAutoApprove` and `approvedCommands` enforcement to subagent Bash calls
- Surface subagent lifecycle (`subagent_start` / `subagent_stop`) in the engine event stream
- Keep external observable behavior identical for the parent agent

**Non-Goals:**
- Changing how `ShellApprovalRepository` stores or retrieves approval state
- Changing the RPC/frontend shell approval UI flow
- Modifying any engine other than the Claude engine
- Adding per-subagent permission isolation (subagents share the task's approval scope)

## Decisions

### Decision 1: PreToolUse hook replaces canUseTool entirely

**Chosen**: Move all Bash shell approval logic from `canUseTool` into a `PreToolUse` hook. Remove `canUseTool` entirely.

**Rationale**: SDK docs explicitly state subagents don't inherit `canUseTool`. The `PreToolUse` hook fires for every tool call in every session context — parent and all subagents. Removing `canUseTool` also eliminates the `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning the SDK emits when a hook always resolves before `canUseTool` is reachable.

**Alternative considered**: Keep `canUseTool` for the parent, add a `PreToolUse` hook for subagents by checking `agent_type`. Rejected: duplicate logic in two places with different return formats; SDK warning persists; harder to reason about.

**Return format difference** (critical migration detail):
```ts
// canUseTool return (OLD):
return { behavior: "allow", updatedInput: input }

// PreToolUse hook return (NEW):
return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: input } }
// deny:
return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Denied by user" } }
```

### Decision 2: Add permissionMode: "bypassPermissions"

**Chosen**: Add `permissionMode: "bypassPermissions"` alongside the `PreToolUse` hook.

**Rationale**: In `bypassPermissions` mode the SDK skips all internal permission channel setup. The `PreToolUse` hook is still invoked even in this mode (SDK docs confirm this). This makes the architecture explicit: only the `PreToolUse` hook gates tool calls. Without this, the SDK's `default` mode still sets up permission infrastructure that is never used.

**Implication for `allowedTools`**: The `allowedTools: ["mcp__railyin__*", ...]` entries remain. In `bypassPermissions` mode, `allowedTools` entries are redundant but harmless — railyin MCP tools will be auto-approved by both the mode and the pre-approval list.

### Decision 3: Subagents use the same shell approval scope as the parent task

**Chosen**: The `PreToolUse` hook reads `shellScope` (task or chat) from the outer closure, shared by both parent and subagent calls.

**Rationale**: Subagents work on behalf of the task. If `shellAutoApprove = true` the task already trusts all shell commands; subagents should too. If specific binaries are approved, subagents executing those binaries should not re-prompt. The user's mental model is "this task can run X" — subagents are internal implementation of that work.

### Decision 4: SubagentStart/SubagentStop hooks emit engine events

**Chosen**: Wire `SubagentStart` → `subagent_start` engine event; `SubagentStop` → new `subagent_stop` engine event. Add `subagent_stop` to `EngineEvent` union and handle in `stream-processor.ts`.

**Rationale**: The Pi engine already emits `subagent_start` for its `delegate` tool. Claude subagents should produce the same lifecycle markers for UI consistency. `subagent_stop` (new) allows the UI to close the subagent container block.

**SubagentStart hook input fields used**:
- `agent_id` → `callId` for the event
- `prompt` → `prompt` field (first 200 chars as intent)

### Decision 5: BashPermissionGate extracted as an injectable class

**Chosen**: Extract all Bash shell approval logic from the `PreToolUse` hook body into `BashPermissionGate` (`src/bun/engine/claude/bash-permission-gate.ts`). `DefaultClaudeSdkAdapter` receives it via constructor injection alongside the existing `ShellApprovalRepository`.

**Rationale**: The `PreToolUse` hook body is complex (auto-approve, binary check, `waitForResume`, `approve_all` persistence). Keeping it inline in `DefaultClaudeSdkAdapter._run()` would make the adapter both a SDK session manager and a permission business logic owner — violating SRP. Extracting it follows the existing DI pattern (see `ShellApprovalRepository` injection at line 292) and enables direct unit tests (`bash-permission-gate.test.ts`) that exercise all approval paths without any Claude SDK involvement.

**API sketch**:
```ts
class BashPermissionGate {
  constructor(shellApprovalRepo: ShellApprovalRepository) {}
  evaluate(
    toolName: string,
    input: Record<string, unknown>,
    scope: ShellScope,
    waitForResume: (payload: ShellApprovalPayload) => Promise<ShellApprovalDecision>,
  ): Promise<PreToolUseResult>
}
```

**DefaultClaudeSdkAdapter constructor**:
```ts
constructor(shellApprovalRepo?: ShellApprovalRepository, bashGate?: BashPermissionGate) {
  this.shellApprovalRepo = shellApprovalRepo ?? new ShellApprovalRepository();
  this.bashGate = bashGate ?? new BashPermissionGate(this.shellApprovalRepo);
}
```

## Risks / Trade-offs

**[Risk] PreToolUse hook timing differs from canUseTool** → The `canUseTool` callback fires before the tool executes and can modify `input`. The `PreToolUse` hook also fires before execution and also supports `updatedInput` via `hookSpecificOutput`. Functionally equivalent; only the return shape differs. Mitigation: adapt `buildAllowPermissionResult` to return the hook-compatible shape.

**[Risk] bypassPermissions disables .claude/settings.json deny rules** → In `bypassPermissions` mode, allow/deny rules from settings files are bypassed. Railyin doesn't rely on settings-file deny rules (all permission logic is in-process). Mitigation: document that the PreToolUse hook is the authoritative gate.

**[Risk] SubagentStart hook input shape may vary** → SDK hook input types are not strongly typed in the installed version. Mitigation: access `agent_id` and `prompt` defensively, falling back to generated IDs.

## Migration Plan

1. Update `DefaultClaudeSdkAdapter._run()`: add `permissionMode`, remove `canUseTool`, add three new hook entries (`PreToolUse`, `SubagentStart`, `SubagentStop`) to the existing `hooks` object
2. Adapt or replace `buildAllowPermissionResult` and `permissionDecisionToResult` helpers to emit `PreToolUse`-compatible hook return objects
3. Add `subagent_stop` to `EngineEvent` union in `types.ts`
4. Handle `subagent_stop` in `stream-processor.ts` to close the subagent UI block
5. No DB migrations, no frontend changes, no RPC type changes required

Rollback: revert `adapter.ts`, `types.ts`, `stream-processor.ts` — no persistent state changes.
