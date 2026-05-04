## MODIFIED Requirements

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

## ADDED Requirements

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
