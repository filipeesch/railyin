## MODIFIED Requirements

### Requirement: interview_me suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that interview_me produces a waiting_user transition and interview prompt event consistently across native, Copilot, and Claude engines. Before invoking the callback, the system SHALL validate the full `interview_me` input against its JSON Schema using the generic `validateToolArgs` helper. Invalid inputs (e.g. missing `questions` field, unknown `type` values) SHALL be returned as descriptive error strings to the model rather than triggering ad-hoc normalisation.

#### Scenario: Copilot interview call suspends via shared callback
- **WHEN** interview_me is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Claude interview call suspends via shared callback
- **WHEN** interview_me is executed during a Claude engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Orchestrator persists interview prompt from any engine
- **WHEN** orchestrator receives interview_me from native, Copilot, or Claude engine
- **THEN** it persists an interview prompt message, sets task execution state to waiting_user, and marks execution as waiting_user

#### Scenario: Invalid interview_me input is rejected with descriptive error
- **WHEN** the Claude engine sends an `interview_me` call with a `type` value that is not one of `exclusive`, `non_exclusive`, `freetext`
- **THEN** `executeCommonTool` returns a descriptive error message naming the invalid value and listing valid options, and the interview callback is NOT invoked
