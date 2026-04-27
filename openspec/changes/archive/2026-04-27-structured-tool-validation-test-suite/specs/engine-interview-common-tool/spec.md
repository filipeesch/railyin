## MODIFIED Requirements

### Requirement: interview_me suspends execution consistently across engines
The system SHALL support callback-driven interview suspension from shared common tool execution so that interview_me produces a waiting_user transition and interview prompt event consistently across native, Copilot, and Claude engines. Before invoking the callback, the system SHALL validate the full `interview_me` input against its JSON Schema using the generic `validateToolArgs` helper.

The test suite SHALL pass `questions` as a real JavaScript array (not `JSON.stringify([...])`) to `executeCommonTool`. Tests asserting on validation error messages SHALL use broad regex matchers rather than exact strings, since the AJV-formatted messages differ from the old ad-hoc messages.

#### Scenario: Copilot interview call suspends via shared callback
- **WHEN** interview_me is executed during a Copilot engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Claude interview call suspends via shared callback
- **WHEN** interview_me is executed during a Claude engine turn
- **THEN** shared tool execution invokes the interview callback and the engine emits an interview_me event before stopping the active turn

#### Scenario: Valid real-array questions triggers suspension
- **WHEN** `executeCommonTool("interview_me", { questions: [{ question: "Q?", type: "exclusive", options: [{title:"A", description:"a"}] }] }, ctx)` is called
- **THEN** the result type is `"suspend"` and the payload contains the questions array

#### Scenario: Missing questions field triggers validation error
- **WHEN** `executeCommonTool("interview_me", {}, ctx)` is called
- **THEN** the result type is `"result"` and the text matches `/questions/`

#### Scenario: Invalid question type triggers validation error
- **WHEN** `executeCommonTool("interview_me", { questions: [{ question: "Q?", type: "single_choice" }] }, ctx)` is called
- **THEN** the result type is `"result"`, the text mentions `"single_choice"`, and the text mentions valid type values
