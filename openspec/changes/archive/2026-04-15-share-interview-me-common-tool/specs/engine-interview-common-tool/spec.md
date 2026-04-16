## ADDED Requirements

### Requirement: interview_me is defined once and shared across all engines
The system SHALL define interview_me as a shared common tool with a single canonical description and JSON schema, and SHALL register that shared definition in native, Copilot, and Claude engine paths.

#### Scenario: Common registry provides interview_me to Copilot
- **WHEN** the Copilot engine builds SDK tools from the shared common tool definitions
- **THEN** interview_me is included in the mapped common tools without a Copilot-exclusive tool object

#### Scenario: Common registry provides interview_me to Claude
- **WHEN** the Claude engine builds MCP tools from the shared common tool definitions
- **THEN** interview_me is included in the registered common tools using the same schema as other engines

#### Scenario: Canonical metadata is consistent across engines
- **WHEN** interview_me tool metadata is inspected from native, Copilot, and Claude registrations
- **THEN** name, description, and parameters are identical for all engines

### Requirement: interview_me suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that interview_me produces a waiting_user transition and interview prompt event consistently across native, Copilot, and Claude engines.

#### Scenario: Copilot interview call suspends via shared callback
- **WHEN** interview_me is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Claude interview call suspends via shared callback
- **WHEN** interview_me is executed during a Claude engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Orchestrator persists interview prompt from any engine
- **WHEN** orchestrator receives interview_me from native, Copilot, or Claude engine
- **THEN** it persists an interview prompt message, sets task execution state to waiting_user, and marks execution as waiting_user
