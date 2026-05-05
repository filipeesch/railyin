# Spec: copilot-lease-timeout-test-coverage

## Purpose

Test coverage requirements for the Copilot lease timeout and session lifecycle fixes. Ensures that eviction guards, `onBeforeEvict` lifecycle, watchdog heartbeat, pre-eviction abort behaviour, touch-lease wiring, and session counter correctness are all verified at both unit and integration levels.

## Requirements

### Requirement: Eviction guard is tested at unit level
The test suite SHALL include unit tests for `DefaultCopilotSdkAdapter` that prove eviction is suppressed when `activeSessions > 0` and proceeds when `activeSessions = 0`.

#### Scenario: Lease timer fires with active session
- **WHEN** the `LeaseRegistry` expire callback fires and `activeSessions > 0`
- **THEN** `evictPoolEntry` is NOT called and `leaseRegistry.touch` is called with `"running"`

#### Scenario: Lease timer fires with no active sessions
- **WHEN** the `LeaseRegistry` expire callback fires and `activeSessions = 0`
- **THEN** `evictPoolEntry` IS called and the pool entry is removed

### Requirement: onBeforeEvict lifecycle is tested at unit level
The test suite SHALL include unit tests proving `onBeforeEvict` callbacks are awaited before eviction, the 5-second deadline is enforced, and unsubscribe removes the callback.

#### Scenario: Callbacks awaited before eviction
- **WHEN** two async `onBeforeEvict` callbacks are registered and eviction is triggered
- **THEN** both callbacks complete before the pool entry is removed (verified by timestamp ordering)

#### Scenario: 5-second deadline enforced
- **WHEN** a registered callback takes longer than 5 seconds
- **THEN** eviction still proceeds within approximately 5.5 seconds and a warning is logged

#### Scenario: Unsubscribe removes callback
- **WHEN** a callback is registered and immediately unsubscribed before eviction
- **THEN** the callback is NOT invoked when eviction is triggered

### Requirement: Watchdog heartbeat is tested at unit level
The test suite SHALL include unit tests for `translateCopilotStream` that prove `onHeartbeat` is called on every watchdog timer fire, including when `toolsInFlight > 0`.

#### Scenario: Heartbeat fires without tools in flight
- **WHEN** the watchdog timer fires and no tools are in flight
- **THEN** `onHeartbeat` is called at least once per timer interval

#### Scenario: Heartbeat fires with tools in flight
- **WHEN** the watchdog timer fires and `toolsInFlight > 0`
- **THEN** `onHeartbeat` is called before the early-return guard, and the stream continues running

### Requirement: Pre-eviction abort yields cancelled status at integration level
The test suite SHALL include an integration test (using `BackendRpcRuntime` and `MockCopilotSdkAdapter`) proving that firing `onBeforeEvict` mid-stream causes the execution to end as `cancelled`, not `failed`.

#### Scenario: Execution ends as cancelled after pre-eviction abort
- **WHEN** a task execution is in progress with an active stream
- **AND** `MockCopilotSdkAdapter.triggerBeforeEvict` is called for the session
- **THEN** `waitForExecutionStatus` resolves to `"cancelled"` (not `"failed"`)
- **AND** the task column remains in its pre-execution state (not `"failed"`)

### Requirement: Touchlease is called during tool execution at integration level
The test suite SHALL include an integration smoke assertion proving the engine calls `touchLease("running")` at least once during a tool execution (verifying Bug B wiring without requiring timer injection at the engine level).

#### Scenario: touchLease called during long tool
- **WHEN** a task execution begins and a tool starts executing
- **THEN** after waiting at least one watchdog interval, `adapter.trace` records at least one `touchLease("running")` call

### Requirement: Session lifecycle counters regression-guarded
The test suite SHALL include regression guard tests that prove `activeSessions` is correctly incremented on session creation and decremented on disconnect after the DI refactor.

#### Scenario: activeSessions increments on create
- **WHEN** `DefaultCopilotSdkAdapter.createSession` is called
- **THEN** `activeSessions` for that pool entry is incremented by 1

#### Scenario: activeSessions decrements on disconnect
- **WHEN** `DefaultCopilotSdkSession.disconnect` is called
- **THEN** `activeSessions` for that pool entry is decremented by 1
