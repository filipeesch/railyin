## ADDED Requirements

### Requirement: Cursor SDK Mock Adapter with AsyncGenerator Pattern

The test infrastructure SHALL provide a mock adapter that simulates the Cursor SDK's `Run.stream()` returning an AsyncGenerator<SDKMessage> for testing.

#### Scenario: AsyncGenerator Mock

- **WHEN** test creates a mock session with queued SDKMessage events
- **THEN** `Run.stream()` returns AsyncGenerator that yields queued SDKMessages
- **AND**Iteration completes when all queued events are emitted

### Requirement: Engine Integration Test for Cursor SDK

The test suite SHALL run Cursor engine integration tests using shared RPC scenarios.

#### Scenario: Single-turn Chat

- **WHEN** Cursor engine executes a single-turn chat
- **THEN** Shared `runSingleTurnChatScenario` passes
- **AND** execution completes with `completed` status

#### Scenario: Multi-turn Chat

- **WHEN** Cursor engine executes multi-turn chat
- **THEN** Shared `runMultiTurnChatScenario` passes
- **AND** conversation history is preserved

### Requirement: Mock SDK Types

The test infrastructure SHALL define TypeScript types for mock SDK components (MockCursorSdkAdapter, MockCursorSession, MockCursorRun).

#### Scenario: Type Safety

- **WHEN** test imports mock types
- **THEN** compilation succeeds with correct types
- **AND** mock implementations satisfy interface contracts

### Requirement: Playwright UI Test for Cursor Engine

Playwright tests SHALL verify Cursor engine appears in model picker and executes correctly.

#### Scenario: Engine Selection

- **WHEN** user selects Cursor engine from model picker
- **THEN** Cursor engine is used for execution
- **AND** execution stream shows Cursor SDK events
