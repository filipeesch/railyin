## MODIFIED Requirements

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
