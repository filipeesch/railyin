## REMOVED Requirements

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree

**Reason**: The delegate tool is being disabled on the Pi engine. Fan-out parallel sub-agent sessions are no longer supported via the Pi engine. The `delegate` tool is removed from the active tool set and will not be offered to the model.

**Migration**: No migration needed for users — this is an internal agent capability. If parallel sub-agent execution is needed in the future, re-enable the delegate tool by restoring the registration lines in `src/bun/engine/pi/tools/index.ts`. The implementation files (`delegate.ts`, `child-session.ts`) are preserved and not deleted.

### Requirement: spawn_agent tool call is intercepted before the standard executeTool path

**Reason**: With the delegate tool disabled, interception logic is no longer needed. The tool is not registered and cannot be called.

**Migration**: None — internal implementation detail with no external API surface.
