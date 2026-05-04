## RENAMED Requirements

### Requirement: interview_me suspends execution consistently across engines
FROM: interview_me suspends execution consistently across engines
TO: decision_request suspends execution consistently across engines

## MODIFIED Requirements

### Requirement: decision_request suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that `decision_request` produces a `waiting_user` transition and decision request event consistently across native, Copilot, and Claude engines. Before invoking the callback, the system SHALL validate the full `decision_request` input against its JSON Schema using the generic `validateToolArgs` helper. Invalid inputs (e.g. missing `questions` field, unknown `type` values, empty `questions` array) SHALL be returned as descriptive error strings to the model rather than triggering ad-hoc normalisation.

The tool definition file SHALL be renamed from `interview-tool-definition.ts` to `decision-request-tool-definition.ts` and the exported constant SHALL be renamed from `INTERVIEW_ME_TOOL_DEFINITION` to `DECISION_REQUEST_TOOL_DEFINITION`.

Tests for this SHALL:
- Pass `questions` as a **real array** (not `JSON.stringify([...])`), since `toToolArgs()` is removed.
- Assert on AJV-formatted error strings using regex matchers (`toMatch(/pattern/)`) not exact string equality.
- NOT mock `validateToolArgs`; invalid args go through the real gate.

#### Scenario: Copilot decision_request call suspends via shared callback
- **WHEN** `decision_request` is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits a `decision_request` event before stopping the active turn

#### Scenario: Claude decision_request call suspends via shared callback
- **WHEN** `decision_request` is executed during a Claude engine turn with `questions` as a real array
- **THEN** shared tool execution invokes the interview callback and the engine emits a `decision_request` event before stopping the active turn

#### Scenario: Orchestrator persists decision_request prompt from any engine
- **WHEN** orchestrator receives `decision_request` from native, Copilot, or Claude engine
- **THEN** it persists a `decision_request_prompt` message, sets task execution state to `waiting_user`, and marks execution as `waiting_user`

#### Scenario: Invalid decision_request input is rejected with descriptive error
- **WHEN** the Claude engine sends a `decision_request` call with a `type` value that is not one of `exclusive`, `non_exclusive`, `freetext`
- **THEN** `executeCommonTool` returns a descriptive error message naming the invalid value and listing valid options, and the interview callback is NOT invoked

#### Scenario: Invalid type enum rejected by AJV gate (regression guard)
- **WHEN** the Claude engine sends a `decision_request` call with `questions: [{ question: "Q?", type: "single_choice", options: [] }]`
- **THEN** `executeCommonTool` returns text that MATCHES `/single_choice/` and does NOT invoke the interview callback

#### Scenario: Empty questions array rejected by minItems gate
- **WHEN** `executeCommonTool("decision_request", { questions: [] }, ctx)` is called
- **THEN** the returned `text` MATCHES `/questions/` AND MATCHES `/minItems|at least 1|required/i` and the callback is NOT invoked

#### Scenario: Missing questions field rejected by required gate
- **WHEN** `executeCommonTool("decision_request", {}, ctx)` is called
- **THEN** the returned `text` MATCHES `/questions/` AND MATCHES `/required|missing/i`

#### Scenario: Valid real-array questions triggers suspension
- **WHEN** `executeCommonTool("decision_request", { questions: [{ question: "Q?", type: "exclusive", options: [{title:"A", description:"a"}] }] }, ctx)` is called
- **THEN** the result type is `"suspend"` and the payload contains the questions array

#### Scenario: Missing questions field triggers validation error
- **WHEN** `executeCommonTool("decision_request", {}, ctx)` is called
- **THEN** the result type is `"result"` and the text matches `/questions/`

#### Scenario: Invalid question type triggers validation error
- **WHEN** `executeCommonTool("decision_request", { questions: [{ question: "Q?", type: "single_choice" }] }, ctx)` is called
- **THEN** the result type is `"result"`, the text mentions `"single_choice"`, and the text mentions valid type values
