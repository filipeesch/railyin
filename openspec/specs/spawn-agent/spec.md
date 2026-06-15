## REMOVED Requirements

**Reason**: The delegate tool is being disabled on the Pi engine. The `spawn_agent` capability (fan-out parallel sub-agent execution) is no longer supported via the Pi engine. The `delegate` tool is removed from the active tool set.

**Migration**: No migration needed — this is an internal agent capability. If parallel sub-agent execution is needed in the future, re-enable the delegate tool by restoring the registration lines in `src/bun/engine/pi/tools/index.ts`. The implementation files (`delegate.ts`, `child-session.ts`) are preserved and not deleted.

### Requirement: spawn_agent runs parallel sub-executions in the parent worktree
**Removed**: Replaced by REMOVED marker above.

### Requirement: spawn_agent tool call is intercepted before the standard executeTool path
**Removed**: Replaced by REMOVED marker above.
