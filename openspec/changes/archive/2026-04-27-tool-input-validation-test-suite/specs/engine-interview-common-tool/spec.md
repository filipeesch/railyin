## MODIFIED Requirements

### Requirement: interview_me suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that interview_me produces a waiting_user transition and interview prompt event consistently across native, Copilot, and Claude engines. Before invoking the callback, the system SHALL validate the full `interview_me` input against its JSON Schema using the generic `validateToolArgs` helper. Invalid inputs (e.g. missing `questions` field, unknown `type` values, empty `questions` array) SHALL be returned as descriptive error strings to the model rather than triggering ad-hoc normalisation.

Tests for this SHALL:
- Pass `questions` as a **real array** (not `JSON.stringify([...])`), since `toToolArgs()` is removed.
- Assert on AJV-formatted error strings using regex matchers (`toMatch(/pattern/)`) not exact string equality.
- NOT mock `validateToolArgs`; invalid args go through the real gate.

#### Scenario: Copilot interview call suspends via shared callback
- **WHEN** interview_me is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Claude interview call suspends via shared callback
- **WHEN** interview_me is executed during a Claude engine turn with `questions` as a real array
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Orchestrator persists interview prompt from any engine
- **WHEN** orchestrator receives interview_me from native, Copilot, or Claude engine
- **THEN** it persists an interview prompt message, sets task execution state to waiting_user, and marks execution as waiting_user

#### Scenario: Invalid type enum rejected by AJV gate (regression guard)
- **WHEN** the Claude engine sends an `interview_me` call with `questions: [{ question: "Q?", type: "single_choice", options: [] }]`
- **THEN** `executeCommonTool` returns text that MATCHES `/single_choice/` and does NOT invoke the interview callback

#### Scenario: Empty questions array rejected by minItems gate
- **WHEN** `executeCommonTool("interview_me", { questions: [] }, ctx)` is called
- **THEN** the returned `text` MATCHES `/questions/` AND MATCHES `/minItems|at least 1|required/i` and the callback is NOT invoked

#### Scenario: Missing questions field rejected by required gate
- **WHEN** `executeCommonTool("interview_me", {}, ctx)` is called
- **THEN** the returned `text` MATCHES `/questions/` AND MATCHES `/required|missing/i`
