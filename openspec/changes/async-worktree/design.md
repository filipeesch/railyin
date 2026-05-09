## Context

Task transitions currently block while git worktree creation runs synchronously. This creates a 1–5 second delay where the RPC request hangs, execution doesn't start, and the UI shows no progress.

Current flow:
```
tasks.transition → registerContext() → await triggerWorktreeIfNeeded() [BLOCKS] → executeTransition()
```

The worktree creation spawns a `git worktree add` subprocess that takes 1–5 seconds. During this time, the RPC request is blocked, the AI execution engine isn't starting yet, and the user sees no feedback.

## Goals / Non-Goals

**Goals:**
- RPC returns immediately while worktree preparation happens in background
- User sees explicit `"preparing"` progress indicator
- Worktree creation is resilient to failures with proper error handling
- Callback interface enables proper separation of worktree lifecycle and execution orchestration
- Clean code architecture following SOLID principles

**Non-Goals:**
- UI worktree progress improvements (separate PR)
- Worktree creation performance optimization (git subprocess remains synchronous)
- Parallel worktree creation for multiple tasks (not needed for single-task workflow)

## Decisions

### 1. State Machine Extension
**Decision**: Add single `"preparing"` execution state
**Rationale**: Simplest approach; `idle → preparing → running` is clear, provides explicit user feedback; `preparing` is a standard term for "waiting for setup"
**Alternatives considered**: 
- Two states (`preparing` + `ready`) — unnecessary complexity
- Keep `idle` during preparation — confusing UX, no user feedback

### 2. Coordination Mechanism
**Decision**: Callback interface (`IWorktreePreparerCallback`) passed to `WorktreeManager`
**Rationale**: Clean separation of concerns; worktree manager knows nothing about execution system; type-safe; easy to test
**Alternatives considered**:
- Direct `IWorktreeExecutor` DI — tight coupling, circular dependency risk
- Event bus — unnecessary abstraction layer for this use case

### 3. Where async boundary lives
**Decision**: Extend existing `WorktreeManager` class
**Rationale**: WorktreeManager already owns git context registration, worktree lifecycle, status management; natural fit; follows SRP
**Alternatives considered**:
- New dedicated `WorktreePreparer` service — unnecessary indirection
- Handler-level async — tight coupling, duplicate logic across multiple handlers

### 4. Refactoring scope
**Decision**: Replace `triggerWorktreeIfNeeded()` entirely with `prepareAndExecute()`
**Rationale**: Centralized cleanup; single entry point; better naming; eliminates duplicate logic
**Alternatives considered**:
- Keep existing method + add new one — maintenance burden, drift risk
- Extract to private helper — not enough cleanup, public API stays confusing

## Risks / Trade-offs

- **Risk**: Worktree creation takes longer than expected → **Mitigation**: Callback handles async completion; task stays in `preparing` state until ready
- **Risk**: Callback timing → **Mitigation**: `prepareAndExecute()` returns immediately; callback only fires on completion/error; no shared state between callbacks
- **Risk**: Memory leak from leaked promises → **Mitigation**: Worktree task tracks existing `prepareAndExecute()` calls; cleanup on task deletion

## Migration Plan

1. Add `"preparing"` to `ExecutionState` union type
2. Create `prepareAndExecute()` in `WorktreeManager`
3. Update `tasks.ts` handlers to use `prepareAndExecute()`
4. Remove `triggerWorktreeIfNeeded()` calls
5. See `async-worktree-tests` proposal for test suite
