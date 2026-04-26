## MODIFIED Requirements

### Requirement: interview_me suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that interview_me produces a waiting_user transition and interview prompt event consistently across native, Copilot, and Claude engines. Before invoking the callback, the system SHALL normalize each question's `type` field to a valid value (`exclusive`, `non_exclusive`, or `freetext`), defaulting to `exclusive` for any unrecognized value.

#### Scenario: Copilot interview call suspends via shared callback

- **WHEN** interview_me is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Claude interview call suspends via shared callback

- **WHEN** interview_me is executed during a Claude engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Orchestrator persists interview prompt from any engine

- **WHEN** orchestrator receives interview_me from native, Copilot, or Claude engine
- **THEN** it persists an interview prompt message, sets task execution state to waiting_user, and marks execution as waiting_user

#### Scenario: Question type is normalized before callback

- **WHEN** the Claude engine sends an `interview_me` call with a question whose `type` is not one of `exclusive`, `non_exclusive`, `freetext`
- **THEN** `executeCommonTool` normalizes the type to `exclusive` before invoking `ctx.onInterviewMe`, so the UI always receives a known type value
