## ADDED Requirements

### Requirement: Backend RPC scenario tests SHALL run against an injected execution coordinator
The system SHALL provide a backend scenario test harness that drives the real task RPC handlers against an injected execution coordinator implementation. The harness SHALL support shared chat scenarios without depending on UI automation.

#### Scenario: Shared scenario suite runs with an injected coordinator
- **WHEN** a backend scenario runtime is created for tests
- **THEN** the task RPC handlers use the injected coordinator contract for transition, human turn, retry, code review, cancel, and model listing operations

#### Scenario: Shared chat scenario calls real task RPC handlers
- **WHEN** a multi-turn chat scenario runs in the backend harness
- **THEN** it invokes task RPC handlers such as `tasks.sendMessage` and asserts on returned payloads, callback emissions, and persisted database state

### Requirement: Engine-specific SDK mocks SHALL drive real engine implementations in backend scenarios
The backend scenario harness SHALL support engine-specific SDK mock adapters so tests can instantiate real engine implementations with mocked SDK classes. Mock adapters SHALL be capable of simulating streaming output, tool calls, interactive pauses, cancellation, fatal failures, and model listing.

#### Scenario: Copilot engine runs with mocked Copilot SDK classes
- **WHEN** a backend test instantiates the real `CopilotEngine` with a mock Copilot SDK adapter
- **THEN** the shared scenario suite can validate Copilot execution behavior without live SDK credentials

#### Scenario: Future engine runs with its own mocked SDK classes
- **WHEN** a future engine such as Claude Code is instantiated with its own SDK mock adapter
- **THEN** the same backend scenario suite can run against that engine through the shared coordinator contract

### Requirement: Backend scenario settling SHALL use observable barriers instead of fixed sleeps
The backend scenario harness SHALL provide waiters based on callback emissions and persisted state transitions rather than fixed sleep intervals. Shared scenarios SHALL use these waiters to detect completion, suspension, failure, and cancellation deterministically.

#### Scenario: Scenario waits for token completion callback
- **WHEN** an execution streams token events and then completes
- **THEN** the scenario harness detects completion from the terminal callback and execution state rather than from a fixed timeout

#### Scenario: Scenario waits for cancellation barrier
- **WHEN** a running execution is cancelled in a shared backend scenario
- **THEN** the scenario harness detects the cancellation outcome from callback and database barriers without relying on arbitrary delays
