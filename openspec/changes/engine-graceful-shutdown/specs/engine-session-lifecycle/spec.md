## ADDED Requirements

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
If a non-native task lease has no activity for 10 minutes, the system SHALL gracefully release that lease's runtime resources. This timeout SHALL also apply while waiting for user input.

#### Scenario: Waiting-user lease expires after 10 minutes of inactivity
- **WHEN** a task is in `waiting_user` and receives no activity for 10 minutes
- **THEN** the lease is gracefully released

#### Scenario: Active lease remains while activity continues
- **WHEN** lease activity occurs within each 10-minute window
- **THEN** the lease is not released for inactivity

### Requirement: Startup SHALL NOT terminate existing engine processes
The system SHALL NOT perform startup-time process termination/reaping as part of this lifecycle capability.

#### Scenario: Application startup leaves historical processes untouched
- **WHEN** the application process starts
- **THEN** no startup routine issues kill/terminate actions for existing Copilot or Claude engine processes
