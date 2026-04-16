## Why

Railyin can accumulate long-lived Copilot/Claude runtime processes because lifecycle cleanup is tied mostly to execution completion, not task activity and app shutdown semantics. We need a structural, engine-agnostic lifecycle model so runtime instances are released predictably after inactivity and on app close.

## What Changes

- Introduce an engine-agnostic task-session lifecycle model for non-native engines (Copilot and Claude) based on active task leases.
- Define and enforce a 10-minute inactivity timeout from last activity, including tasks in waiting-user state.
- Add graceful shutdown orchestration for all active non-native task sessions when the app exits (including macOS close-window path when configured to quit).
- Align Copilot and Claude behavior so both engines follow the same lifecycle semantics.
- Explicitly prohibit startup-time termination/reaping of historical engine processes.

## Capabilities

### New Capabilities
- `engine-session-lifecycle`: Unified lease-based lifecycle management for task-scoped non-native engine runtimes, including inactivity and app-exit shutdown behavior.

### Modified Capabilities
- `execution-engine`: Extend engine/orchestrator contract to support engine-wide graceful shutdown and lifecycle orchestration.
- `copilot-engine`: Change runtime lifecycle from execution-scoped cleanup toward active-task lease semantics with inactivity expiration and app-exit shutdown.
- `claude-engine`: Add equivalent active-task lease semantics, inactivity expiration, and app-exit graceful shutdown to match Copilot behavior.

## Impact

- Affected modules: engine contracts, orchestrator lifecycle control, app exit handling, Copilot session adapter, Claude adapter.
- Likely files: `src/bun/engine/types.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/index.ts`, `src/bun/engine/copilot/session.ts`, `src/bun/engine/copilot/engine.ts`, `src/bun/engine/claude/adapter.ts`, `src/bun/engine/claude/engine.ts`.
- Behavior impact: fewer orphaned runtime processes, consistent non-native engine lifecycle, bounded resource usage.
- No startup process sweep/reaper is introduced by this change.
