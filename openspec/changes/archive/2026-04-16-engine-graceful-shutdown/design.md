## Context

Railyin supports multiple execution engines with different runtime adapters. Copilot and Claude keep engine-side runtime/session state across turns, but cleanup behavior is inconsistent and mostly execution-scoped. This can leave stale runtime processes when user interaction pauses in `waiting_user` or when app exit does not run full graceful cleanup. Current behavior can diverge between Copilot and Claude and does not provide a single lifecycle authority for task-scoped runtime leases.

User requirements for this change are:
- Session ownership should be per active task for non-native engines.
- If a task has no activity for 10 minutes, its runtime instance should be gracefully shut down.
- Active non-native runtimes should be gracefully shut down on app close/quit.
- No startup-time process termination is allowed.

## Goals / Non-Goals

**Goals:**
- Define one engine-agnostic lifecycle model for non-native engines.
- Enforce a consistent inactivity timeout (10 minutes) based on task activity, including `waiting_user` periods.
- Ensure app close/quit initiates graceful shutdown of active non-native runtimes.
- Keep deterministic per-task session identity so context can be resumed after lease release.
- Keep behavior symmetrical between Copilot and Claude.

**Non-Goals:**
- Reworking native engine lifecycle behavior.
- Introducing startup cleanup/reaping logic for historical processes.
- Changing model selection, tool semantics, or prompt behavior.
- Persisting long-lived process metadata outside runtime needs.

## Decisions

### 1. Introduce task-session lease lifecycle as the single authority
Rationale: execution-scoped cleanup is not sufficient for paused/resumable interactions. A lease keyed by `(engineType, workspaceKey, taskId)` represents ownership of a non-native runtime instance and can be reasoned about independently of short-lived executions.

Alternatives considered:
- Keep per-execution lifecycle only: rejected because it cannot model inactive waiting-user sessions correctly.
- Engine-specific lifecycle logic only: rejected because behavior diverges and becomes difficult to verify across engines.

### 2. Activity-based timeout policy applies to both running and waiting-user states
Rationale: user intent is task activity, not execution status. A task can be waiting for user input indefinitely without activity and should still expire.

Policy:
- `lastActivityAt` is updated on model output, tool events, user resume input, and task interactions that consume/resume engine state.
- If `now - lastActivityAt >= 10 minutes`, lease transitions to graceful close.

Alternatives considered:
- Timeout only during idle-not-waiting: rejected; does not solve waiting-user accumulation.
- Different timeout per engine: rejected for UX inconsistency.

### 3. Graceful app-exit shutdown is orchestrated centrally with bounded deadline
Rationale: per-execution finally blocks are not enough when the app exits. The orchestrator must ask all non-native engines to gracefully close active leases before process termination.

Policy:
- App exit path invokes orchestrator/engine global graceful shutdown.
- Shutdown uses bounded deadline and best-effort completion semantics.
- Existing force-termination fallback remains only as a fallback path after grace period.

Alternatives considered:
- Rely on process-group kill only: rejected; causes orphan risk and skips graceful adapter cleanup.
- Engine self-shutdown without orchestrator coordination: rejected due to poor global visibility.

### 4. Keep deterministic task session IDs while allowing lease release
Rationale: release of runtime process should not destroy task continuity. Deterministic session IDs allow a released lease to be reacquired later and resume prior context where supported.

Alternatives considered:
- New random session per reacquire: rejected because it loses continuity.

### 5. No startup reaper
Rationale: explicit requirement from product direction. Startup behavior remains non-destructive.

Alternatives considered:
- Startup stale-process cleanup: rejected for this change scope.

## Risks / Trade-offs

- [Risk] Close-window behavior on macOS may not map to app quit in all cases. → Mitigation: specify and test exact close/quit behavior contract and verify hook coverage.
- [Risk] Timeout may close a lease shortly before user responds. → Mitigation: deterministic session IDs and fast reacquire path on next user action.
- [Risk] Deadline-based graceful shutdown can still leave processes in extreme failure modes. → Mitigation: maintain hard-stop fallback and emit observability signals for forced termination.
- [Risk] New lifecycle abstraction adds complexity to orchestrator/engine contract. → Mitigation: keep contract minimal and engine-agnostic, with adapter-specific internals.

## Migration Plan

1. Introduce lifecycle contract additions in execution engine and orchestrator coordination points.
2. Implement Copilot lease activity tracking and inactivity expiry under the shared contract.
3. Implement Claude lease activity tracking and inactivity expiry under the shared contract.
4. Wire app exit path to orchestrated graceful shutdown with timeout fallback.
5. Add tests for inactivity timeout, waiting-user expiry, and app-exit graceful shutdown for both engines.

Rollback strategy:
- Disable lifecycle timeout enforcement and app-exit orchestration behind configuration/feature guard if regressions appear.
- Retain existing per-execution cleanup behavior as fallback during rollback.

## Open Questions

- Should macOS red close button always imply full app quit for Railyn, or only when closing the final window?
- What exact grace deadline is acceptable for app-exit shutdown without hurting UX?
- Should lease activity be updated by read-only task UI interactions, or only by model/tool/user-resume events?
