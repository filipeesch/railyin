## 1. Lifecycle Contract

- [x] 1.1 Extend the execution engine contract with optional graceful shutdown semantics for non-native engines.
- [x] 1.2 Add orchestrator-level lifecycle coordination for task-scoped non-native leases.
- [x] 1.3 Add shared lease metadata model (`leaseKey`, `lastActivityAt`, state) for engine-agnostic tracking.

## 2. Activity Tracking And Timeout

- [x] 2.1 Define and implement shared activity update triggers from engine events and resume input paths.
- [x] 2.2 Enforce 10-minute inactivity expiration for non-native leases, including waiting-user state.
- [x] 2.3 Ensure lease reacquisition uses deterministic task session identity after expiration.

## 3. Copilot Lifecycle Alignment

- [x] 3.1 Refactor Copilot adapter/session pool to use task lease activity timestamps rather than execution-only lifecycle.
- [x] 3.2 Ensure waiting-user Copilot leases expire after 10 minutes of inactivity.
- [x] 3.3 Add graceful close-all for active Copilot leases used during app shutdown.

## 4. Claude Lifecycle Alignment

- [x] 4.1 Add task lease tracking for Claude active queries/runtime handles.
- [x] 4.2 Enforce the same 10-minute inactivity expiration policy for Claude leases, including waiting-user state.
- [x] 4.3 Add graceful close-all for active Claude leases used during app shutdown.

## 5. App Close / Quit Behavior

- [x] 5.1 Define and implement macOS close-window-to-quit behavior expected by product policy.
- [x] 5.2 Invoke orchestrated graceful shutdown on app quit with bounded deadline before hard fallback.
- [x] 5.3 Preserve existing fallback termination behavior only after graceful shutdown deadline.

## 6. Guardrails And Validation

- [x] 6.1 Verify no startup-time process termination is introduced.
- [x] 6.2 Add automated tests for inactivity expiration in running and waiting-user states for both engines.
- [x] 6.3 Add automated tests for app-exit graceful shutdown coverage across Copilot and Claude.
- [x] 6.4 Add observability/logging assertions for lease creation, expiration, graceful close, and fallback close paths.
