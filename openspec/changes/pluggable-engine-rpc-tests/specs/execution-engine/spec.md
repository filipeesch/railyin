## MODIFIED Requirements

### Requirement: Orchestrator consumes engine events and handles persistence and relay
The orchestrator SHALL consume the `AsyncIterable<EngineEvent>` produced by the engine and handle all engine-agnostic concerns: persisting conversation messages to the database, relaying streaming tokens to the frontend via RPC, updating execution and task state in the database, managing AbortController lifecycle, and recording token usage.

For pluggable non-native engines, cancellation SHALL use dual-state persistence: the execution row SHALL transition to `cancelled`, and the task row SHALL transition to `waiting_user` so a later human turn can resume work. Shared backend tests SHALL be able to observe these outcomes through RPC callbacks and persisted state.

#### Scenario: Orchestrator persists tool call messages
- **WHEN** the orchestrator receives `tool_start` and `tool_result` events
- **THEN** it writes `tool_call` and `tool_result` conversation messages to the database

#### Scenario: Orchestrator accumulates tokens into assistant message
- **WHEN** the orchestrator receives a sequence of `token` events followed by a `done` event
- **THEN** it persists a single assistant message containing the concatenated token content

#### Scenario: Orchestrator relays tokens to frontend in real time
- **WHEN** the orchestrator receives a `token` event
- **THEN** it immediately sends a `stream.token` RPC message to the frontend

#### Scenario: Orchestrator handles AbortController lifecycle
- **WHEN** a new execution starts
- **THEN** an AbortController is registered in the execution map; when the execution ends (done, error, or cancel), the controller is removed

#### Scenario: Orchestrator updates execution state on completion
- **WHEN** the orchestrator receives a `done` event
- **THEN** it updates `execution.status` to `completed` and `task.execution_state` to `completed` in the database

#### Scenario: Orchestrator updates execution state on error
- **WHEN** the orchestrator receives a fatal `error` event
- **THEN** it updates `execution.status` to `failed` and `task.execution_state` to `failed` in the database

#### Scenario: Orchestrator updates cancellation state for pluggable engines
- **WHEN** a non-native execution is cancelled while streaming or waiting on SDK activity
- **THEN** it updates `execution.status` to `cancelled`, updates `task.execution_state` to `waiting_user`, and stops relaying additional tokens for that execution

## ADDED Requirements

### Requirement: Task RPC handlers SHALL depend on an execution coordinator contract
The backend task RPC layer SHALL depend on an execution coordinator contract rather than the concrete orchestrator class. The contract SHALL expose the transition, human turn, retry, code review, cancel, and model-listing operations needed by task handlers.

#### Scenario: Production wiring injects the real orchestrator through the coordinator contract
- **WHEN** the application boots in normal operation
- **THEN** task RPC handlers receive the production orchestrator through the execution coordinator contract

#### Scenario: Tests inject a coordinator backed by a real engine implementation
- **WHEN** a backend scenario test creates task RPC handlers
- **THEN** it can inject a coordinator backed by the real Copilot engine with mocked SDK classes or another pluggable engine implementation

### Requirement: Shared backend scenarios SHALL assert coordinator behavior through RPC contracts
The system SHALL support backend scenario tests that invoke task RPC handlers and verify both immediate RPC return values and eventual coordinator side effects such as callback emissions, conversation persistence, token usage, and terminal execution states.

#### Scenario: Multi-turn chat scenario verifies RPC return and eventual persistence
- **WHEN** a backend scenario sends multiple task messages through the RPC handler layer
- **THEN** it can assert the immediate user message payloads as well as the eventual assistant messages and execution rows persisted by the coordinator

#### Scenario: Tool-call scenario verifies RPC return and tool persistence
- **WHEN** a backend scenario triggers a tool-using execution through the RPC handler layer
- **THEN** it can assert that tool-call and tool-result messages are persisted in order alongside the final assistant response
