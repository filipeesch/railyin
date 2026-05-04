## MODIFIED Requirements

### Requirement: Copilot engine recycles idle CLI processes to conserve resources
The system SHALL evaluate Copilot lease inactivity against a 10-minute timeout based on task activity timestamps. The timeout SHALL apply uniformly to running and waiting-user task leases. Access and runtime events for a lease SHALL refresh its activity timestamp. The timeout SHALL NOT trigger eviction while SDK sessions are actively in progress; the lease timer SHALL be reset in that case.

#### Scenario: Idle Copilot runtime is stopped after 10 minutes without activity
- **WHEN** no activity is observed for a task lease for 10 consecutive minutes and no SDK sessions are active
- **THEN** the Copilot CLI process for that lease is stopped and lease resources are removed

#### Scenario: Lease remains while activity continues
- **WHEN** task activity is observed within each 10-minute window
- **THEN** the Copilot lease remains active and is not evicted

#### Scenario: Eviction timer resets instead of evicting during active streaming
- **WHEN** the 10-minute inactivity timer fires while one or more SDK sessions are active on that lease
- **THEN** the lease timer is reset and the CLI process is NOT stopped

## ADDED Requirements

### Requirement: Watchdog SHALL touch the lease on every timer fire during tool execution
The system SHALL call `touchLease` on every watchdog timer fire regardless of whether tools are currently in flight. This prevents the lease from expiring during long-running tool executions that produce no SDK session events.

#### Scenario: Lease is touched on watchdog fire during tool execution
- **WHEN** the 120s watchdog fires while `toolsInFlight > 0`
- **THEN** `touchLease` is called to refresh the lease activity timestamp before returning

#### Scenario: Lease is touched on watchdog fire with no tools running
- **WHEN** the 120s watchdog fires while no tools are in flight
- **THEN** `touchLease` is called as part of the normal watchdog flow
