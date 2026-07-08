## Why

After upgrading the Claude Agent SDK from v0.2.x to v0.3.x, all subagent tool calls fail with "Tool permission request failed: Error: Stream closed". The SDK now spawns subagents as background tasks that do not inherit the parent's `canUseTool` callback, leaving them with no permission gate — the SDK attempts to open a permission stream, finds none, and closes it immediately. The same root cause also silently breaks `shell_auto_approve`: workspace-level auto-approval works for the parent agent but not for any subagent it spawns.

## What Changes

- **Remove** `canUseTool` callback from `sdk.query()` options in `DefaultClaudeSdkAdapter`
- **Add** `permissionMode: "bypassPermissions"` so the SDK does not set up internal permission channels
- **Add** `PreToolUse` hook that acts as the single permission gate for both the parent agent and all subagents — it contains all Bash shell approval logic currently in `canUseTool`
- **Add** `SubagentStart` hook to emit a `subagent_start` engine event when Claude spawns a subagent
- **Add** `SubagentStop` hook to emit a new `subagent_stop` engine event when a subagent completes
- **Add** `subagent_stop` to the `EngineEvent` union in `engine/types.ts`
- **Add** `subagent_stop` handling in `stream-processor.ts` to close the subagent block in the UI

## Capabilities

### New Capabilities

- `claude-subagent-permission-gate`: Bash shell approval for subagents spawned by the Claude engine — `PreToolUse` hook fires for all tool calls in both parent and subagent contexts, enforcing the same `shellAutoApprove` / `approvedCommands` logic as the parent
- `claude-subagent-lifecycle-events`: `subagent_start` and `subagent_stop` engine events emitted by `SubagentStart`/`SubagentStop` SDK hooks, giving the stream processor and UI visibility into subagent lifecycle

### Modified Capabilities

- `claude-engine`: The permission mechanism changes from `canUseTool` callback to a `PreToolUse` hook with `bypassPermissions` mode. External observable behavior is identical for the parent agent; subagent tool calls now work correctly instead of erroring.
- `shell-command-approval`: No requirement changes. The per-task `shellAutoApprove` and `approvedCommands` enforcement now applies to subagent Bash calls in addition to parent agent calls.

## Impact

- **`src/bun/engine/claude/adapter.ts`** — core change: remove `canUseTool`, add `PreToolUse`/`SubagentStart`/`SubagentStop` hooks, add `permissionMode: "bypassPermissions"`
- **`src/bun/engine/types.ts`** — add `subagent_stop` to `EngineEvent` union
- **`src/bun/engine/stream/stream-processor.ts`** — handle `subagent_stop` case
- **No changes** to `ShellApprovalRepository`, `shell-approval-repository.ts`, RPC types, frontend, or any other engine
- **SDK dependency**: `@anthropic-ai/claude-agent-sdk` v0.3.x (already installed); `PreToolUse`, `SubagentStart`, `SubagentStop` hooks and `bypassPermissions` mode are all available in this version
