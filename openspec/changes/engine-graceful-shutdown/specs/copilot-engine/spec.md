## MODIFIED Requirements

### Requirement: Copilot engine session lifecycle is one session per active task lease
The system SHALL maintain a dedicated Copilot runtime lease per active task session identity. The lease SHALL be reused across resumable turns for the same task and SHALL be gracefully released when no task activity is observed for the configured inactivity window.

#### Scenario: Active task reuses same lease
- **WHEN** multiple resumable turns execute for the same task session ID
- **THEN** the engine reuses the same Copilot lease/runtime while the task remains active

#### Scenario: Inactive task lease is released
- **WHEN** no lease activity is observed for 10 consecutive minutes
- **THEN** the engine gracefully disconnects and releases that task's Copilot runtime lease

#### Scenario: Waiting-user lease still expires on inactivity
- **WHEN** a task is in waiting-user state with no lease activity for 10 minutes
- **THEN** the Copilot runtime lease is gracefully released

### Requirement: Copilot engine recycles idle CLI processes to conserve resources
The system SHALL evaluate Copilot lease inactivity against a 10-minute timeout based on task activity timestamps. The timeout SHALL apply uniformly to running and waiting-user task leases. Access and runtime events for a lease SHALL refresh its activity timestamp.

#### Scenario: Idle Copilot runtime is stopped after 10 minutes without activity
- **WHEN** no activity is observed for a task lease for 10 consecutive minutes
- **THEN** the Copilot CLI process for that lease is stopped and lease resources are removed

#### Scenario: Lease remains while activity continues
- **WHEN** task activity is observed within each 10-minute window
- **THEN** the Copilot lease remains active and is not evicted

## ADDED Requirements

### Requirement: Copilot leases SHALL be gracefully closed during app exit
On app exit flow, all active Copilot task leases SHALL be asked to gracefully close before fallback hard termination.

#### Scenario: App exit closes all active Copilot leases
- **WHEN** app quit flow begins
- **THEN** the Copilot adapter attempts graceful closure for all active Copilot leases within a bounded deadline

#### Scenario: Startup does not kill Copilot runtimes
- **WHEN** the app starts
- **THEN** no startup path terminates Copilot runtimes as part of this capability
