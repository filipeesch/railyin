## Purpose
Defines shared task-scoped runtime lease lifecycle rules for non-native engines so Copilot and Claude behave consistently across running, waiting-user, timeout, and app-exit paths.

## Requirements

### Requirement: Non-native engines SHALL use task-scoped runtime leases
The system SHALL manage Copilot and Claude runtime ownership using task-scoped leases keyed by engine type, workspace, and task identity. A lease SHALL represent ownership of runtime state independently from any single execution attempt.

#### Scenario: Lease key is deterministic per task context
- **WHEN** the orchestrator requests a non-native runtime for a task
- **THEN** the lease key is derived from `(engineType, workspaceKey, taskId)` and reused for future activity on that task

#### Scenario: Runtime reacquisition uses existing task session identity
- **WHEN** a lease was previously released due to inactivity and the user resumes the task
- **THEN** the engine reacquires runtime resources using the same deterministic task session identity

### Requirement: Lease activity SHALL be tracked uniformly across engines
The system SHALL update `lastActivityAt` for non-native task leases on model/tool output and user-driven resume activity. Activity tracking SHALL apply consistently to Copilot and Claude.

#### Scenario: Model output updates activity timestamp
- **WHEN** a non-native engine emits token, reasoning, status, tool_start, or tool_result events
- **THEN** the corresponding lease `lastActivityAt` is updated

#### Scenario: User resume input updates activity timestamp
- **WHEN** a waiting execution receives user input or shell approval response
- **THEN** the corresponding lease `lastActivityAt` is updated

### Requirement: Inactivity timeout SHALL gracefully release non-native leases
If a non-native task lease has no activity for 10 minutes, the system SHALL gracefully release that lease's runtime resources. This timeout SHALL also apply while waiting for user input. Eviction SHALL be suppressed when the runtime reports active sessions in progress; the lease timer SHALL be reset instead of evicting.

#### Scenario: Waiting-user lease expires after 10 minutes of inactivity
- **WHEN** a task is in `waiting_user` and receives no activity for 10 minutes
- **THEN** the lease is gracefully released

#### Scenario: Active lease remains while activity continues
- **WHEN** lease activity occurs within each 10-minute window
- **THEN** the lease is not released for inactivity

#### Scenario: Eviction is suppressed while sessions are actively streaming
- **WHEN** the inactivity timer fires and one or more SDK sessions are actively in progress for that lease
- **THEN** the lease timer is reset (touch) and the runtime is NOT evicted

### Requirement: Startup SHALL NOT terminate existing engine processes
The system SHALL NOT perform startup-time process termination/reaping as part of this lifecycle capability.

#### Scenario: Application startup leaves historical processes untouched
- **WHEN** the application process starts
- **THEN** no startup routine issues kill/terminate actions for existing Copilot or Claude engine processes

### Requirement: Cancelling an execution SHALL remove its controller entry
When an execution is cancelled, the system SHALL abort its `AbortController` AND remove the controller entry from the execution registry. After cancellation, the execution ID SHALL NOT retain any stale controller state.

#### Scenario: Controller entry removed after cancel
- **WHEN** `cancelExecution(executionId)` is called
- **THEN** the `AbortController` for that ID is aborted AND its entry is deleted from the execution registry

#### Scenario: Same executionId can be reused after cancel
- **WHEN** an execution is cancelled and a new execution starts with the same ID
- **THEN** the new execution receives a fresh `AbortController` with no residual abort state

#### Scenario: Stale controller does not block cancellation path
- **WHEN** a test or second execution process calls cancel for an ID that was previously cancelled
- **THEN** the system does NOT early-return on a pre-aborted stale controller; instead the entry is absent and cancellation is a no-op with no side effects

### Requirement: Eviction SHALL abort active executions before killing the runtime
When a non-native lease is evicted while an engine is streaming, the system SHALL notify registered pre-eviction callbacks before killing the runtime process. Registered engines SHALL abort their active execution, causing the execution to end with a `cancelled` outcome rather than a fatal error. The task SHALL NOT be marked `failed` as a result of lease-driven eviction.

#### Scenario: Pre-eviction hook fires before runtime is killed
- **WHEN** a non-native lease is evicted and a pre-eviction callback is registered
- **THEN** the callback is awaited before the CLI process is stopped

#### Scenario: Active execution ends as cancelled on eviction
- **WHEN** a lease eviction aborts an in-progress execution
- **THEN** the execution terminates with a `cancelled` outcome (not `failed`)

#### Scenario: Task is not marked failed after eviction
- **WHEN** a task's Copilot execution is cut short by lease eviction
- **THEN** the task execution state is NOT set to `failed`
